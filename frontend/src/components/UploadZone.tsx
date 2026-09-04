"use client";

import { useCallback, useRef, useState } from "react";
import { clsx } from "clsx";
import { UploadCloud, FileImage, FileVideo, X } from "lucide-react";
import type { DetectionMode } from "@/types/detection";

interface UploadZoneProps {
  mode: Extract<DetectionMode, "image" | "video">;
  file: File | null;
  onFileSelected: (file: File | null) => void;
}

const acceptByMode: Record<UploadZoneProps["mode"], string> = {
  image: "image/*",
  video: "video/*",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UploadZone({ mode, file, onFileSelected }: UploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
      const dropped = event.dataTransfer.files?.[0];
      if (dropped) onFileSelected(dropped);
    },
    [onFileSelected]
  );

  return (
    <div>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={clsx(
          "group relative flex cursor-pointer flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border border-dashed px-4 py-9 text-center transition-all duration-200",
          isDragging
            ? "border-emerald-400/70 bg-emerald-500/[0.06] shadow-[0_0_24px_-8px_rgba(16,185,129,0.6)]"
            : "border-white/10 bg-black/20 hover:border-emerald-400/30 hover:bg-white/[0.02]"
        )}
      >
        <div
          className={clsx(
            "flex h-11 w-11 items-center justify-center rounded-xl ring-1 ring-inset transition-colors",
            isDragging
              ? "bg-emerald-500/15 ring-emerald-400/40"
              : "bg-white/5 ring-white/10 group-hover:ring-emerald-400/20"
          )}
        >
          <UploadCloud
            className={clsx(
              "h-5 w-5 transition-colors",
              isDragging ? "text-emerald-300" : "text-slate-500 group-hover:text-emerald-400"
            )}
          />
        </div>
        <p className="text-sm text-slate-300">
          Drop {mode === "image" ? "an image" : "a video"} here
        </p>
        <p className="text-[11px] text-slate-600">or click to browse</p>
        <input
          ref={inputRef}
          type="file"
          accept={acceptByMode[mode]}
          className="hidden"
          onChange={(e) => onFileSelected(e.target.files?.[0] ?? null)}
        />
      </div>

      {file && (
        <div className="mt-3 flex items-center justify-between rounded-lg border border-white/10 bg-black/30 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-emerald-500/10 ring-1 ring-inset ring-emerald-400/20">
              {mode === "image" ? (
                <FileImage className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <FileVideo className="h-3.5 w-3.5 text-emerald-400" />
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs text-slate-200">{file.name}</p>
              <p className="font-mono text-[10px] text-slate-500">{formatBytes(file.size)}</p>
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onFileSelected(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
            className="shrink-0 rounded-md p-1 text-slate-500 hover:bg-white/5 hover:text-slate-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
