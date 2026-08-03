// Lightweight EXIF metadata reader for JPEG files (no external deps).
// Supports a curated set of commonly used tags — enough to surface provenance.

export type ExifData = Record<string, string | number | undefined>;

const TAG_NAMES: Record<number, string> = {
  0x010f: "Make",
  0x0110: "Model",
  0x0112: "Orientation",
  0x011a: "XResolution",
  0x011b: "YResolution",
  0x0128: "ResolutionUnit",
  0x0131: "Software",
  0x0132: "DateTime",
  0x013b: "Artist",
  0x013e: "WhitePoint",
  0x013f: "PrimaryChromaticities",
  0x0211: "YCbCrCoefficients",
  0x0213: "YCbCrPositioning",
  0x0214: "ReferenceBlackWhite",
  0x8298: "Copyright",
  0x8769: "ExifIFDPointer",
  0x8825: "GPSIFDPointer",
  // EXIF subdirectory
  0x829a: "ExposureTime",
  0x829d: "FNumber",
  0x8822: "ExposureProgram",
  0x8827: "ISOSpeedRatings",
  0x9000: "ExifVersion",
  0x9003: "DateTimeOriginal",
  0x9004: "DateTimeDigitized",
  0x9201: "ShutterSpeedValue",
  0x9202: "ApertureValue",
  0x9204: "ExposureBiasValue",
  0x9205: "MaxApertureValue",
  0x9207: "MeteringMode",
  0x9208: "LightSource",
  0x9209: "Flash",
  0x920a: "FocalLength",
  0x927c: "MakerNote",
  0x9286: "UserComment",
  0xa001: "ColorSpace",
  0xa002: "PixelXDimension",
  0xa003: "PixelYDimension",
  0xa20e: "FocalPlaneXResolution",
  0xa20f: "FocalPlaneYResolution",
  0xa210: "FocalPlaneResolutionUnit",
  0xa402: "ExposureMode",
  0xa403: "WhiteBalance",
  0xa404: "DigitalZoomRatio",
  0xa405: "FocalLengthIn35mmFilm",
  0xa406: "SceneCaptureType",
  0xa432: "LensSpecification",
  0xa433: "LensMake",
  0xa434: "LensModel",
  0xa435: "LensSerialNumber",
};

function readAscii(view: DataView, start: number, length: number): string {
  let s = "";
  for (let i = 0; i < length; i++) {
    const c = view.getUint8(start + i);
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s.trim();
}

function readRational(view: DataView, offset: number): number {
  const num = view.getUint32(offset, false);
  const den = view.getUint32(offset + 4, false);
  return den === 0 ? 0 : num / den;
}

function readValue(view: DataView, type: number, _count: number, offset: number): string | number | undefined {
  switch (type) {
    case 1: // BYTE
      return view.getUint8(offset);
    case 2: // ASCII
      return readAscii(view, offset, _count);
    case 3: // SHORT
      return view.getUint16(offset, false);
    case 4: // LONG
      return view.getUint32(offset, false);
    case 5: // RATIONAL
      return readRational(view, offset);
    case 7: // UNDEFINED
      return _count > 0 ? view.getUint8(offset) : undefined;
    case 10: // SRATIONAL
      return (view.getInt32(offset, false) || 0) / (view.getInt32(offset + 4, false) || 1);
    default:
      return undefined;
  }
}

function parseIFD(view: DataView, ifdStart: number, baseOffset: number): ExifData {
  const data: ExifData = {};
  if (ifdStart + 2 > view.byteLength) return data;

  const numEntries = view.getUint16(ifdStart, false);
  for (let i = 0; i < numEntries; i++) {
    const entryOffset = ifdStart + 2 + i * 12;
    if (entryOffset + 12 > view.byteLength) break;

    const tag = view.getUint16(entryOffset, false);
    const type = view.getUint16(entryOffset + 2, false);
    const count = view.getUint32(entryOffset + 4, false);

    const typeBytes: Record<number, number> = {
      1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8, 11: 4, 12: 8,
    };
    const valueBytes = (typeBytes[type] ?? 0) * count;
    const valueOffset = valueBytes <= 4
      ? entryOffset + 8
      : baseOffset + view.getUint32(entryOffset + 8, false);

    const name = TAG_NAMES[tag];
    if (!name) continue;
    const value = readValue(view, type, count, valueOffset);
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "string" || typeof value === "number") {
      data[name] = value;
    } else {
      data[name] = String(value);
    }
  }
  return data;
}

export async function readExif(file: File | Blob): Promise<ExifData> {
  const buffer = await file.slice(0, Math.min(file.size, 256 * 1024)).arrayBuffer();
  const view = new DataView(buffer);

  // JPEG magic: 0xFFD8 start, 0xFFE1 (APP1 = EXIF)
  if (view.byteLength < 4 || view.getUint16(0, false) !== 0xffd8) return {};

  let offset = 2;
  while (offset < view.byteLength) {
    if (view.getUint8(offset) !== 0xff) break;
    const marker = view.getUint16(offset, false);
    const size = view.getUint16(offset + 2, false);
    if (marker === 0xffe1) {
      // Verify "Exif\0\0"
      if (view.getUint32(offset + 4, false) === 0x45786966) {
        const tiffStart = offset + 10;
        const little = view.getUint16(tiffStart, false) === 0x4949;
        const ifd0Offset = tiffStart + view.getUint32(tiffStart + 4, little);
        const data = parseIFD(view, ifd0Offset, tiffStart);

        // Sub-IFDs
        const exifPointer = data["ExifIFDPointer"];
        if (typeof exifPointer === "number") {
          Object.assign(data, parseIFD(view, tiffStart + exifPointer, tiffStart));
        }
        const gpsPointer = data["GPSIFDPointer"];
        if (typeof gpsPointer === "number") {
          Object.assign(data, parseIFD(view, tiffStart + gpsPointer, tiffStart));
        }
        return data;
      }
    }
    offset += 2 + size;
    if (marker === 0xffda /* SOS */) break;
  }

  return {};
}

export function summarizeExif(exif: ExifData): string {
  const parts: string[] = [];
  if (exif.Make) parts.push(String(exif.Make));
  if (exif.Model) parts.push(String(exif.Model));
  if (typeof exif.FocalLength === "number") parts.push(`${exif.FocalLength}mm`);
  if (typeof exif.FNumber === "number") parts.push(`ƒ/${exif.FNumber}`);
  if (typeof exif.ExposureTime === "number") {
    parts.push(exif.ExposureTime < 1 ? `1/${Math.round(1 / exif.ExposureTime)}s` : `${exif.ExposureTime}s`);
  }
  if (typeof exif.ISOSpeedRatings === "number") parts.push(`ISO ${exif.ISOSpeedRatings}`);
  if (exif.DateTimeOriginal) parts.push(String(exif.DateTimeOriginal));
  return parts.join(" · ");
}
