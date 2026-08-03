import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { toast as sonner } from "sonner";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export type ToastProps = {
  title?: string;
  description?: string;
  variant?: "default" | "destructive";
};

export function toast({ title, description, variant }: ToastProps) {
  if (variant === "destructive") {
    sonner.error(title, { description });
  } else {
    sonner(title ?? "Notice", { description });
  }
}
