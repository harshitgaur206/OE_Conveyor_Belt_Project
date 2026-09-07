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
            ? "border-accent/70 bg-accent/[0.06]"
            : "border-border bg-bg-subtle/40 hover:border-accent/30 hover:bg-bg-subtle/60"
        )}
      >
        <div
          className={clsx(
            "flex h-11 w-11 items-center justify-center rounded-xl ring-1 ring-inset transition-colors",
            isDragging ? "bg-accent/15 ring-accent/40" : "bg-bg-subtle ring-border group-hover:ring-accent/20"
          )}
        >
          <UploadCloud
            className={clsx(
              "h-5 w-5 transition-colors",
              isDragging ? "text-accent" : "text-text-faint group-hover:text-accent"
            )}
          />
        </div>
        <p className="text-sm text-text-muted">
          Drop {mode === "image" ? "an image" : "a video"} here
        </p>
        <p className="text-[11px] text-text-faint">or click to browse</p>
        <input
          ref={inputRef}
          type="file"
          accept={acceptByMode[mode]}
          className="hidden"
          onChange={(e) => onFileSelected(e.target.files?.[0] ?? null)}
        />
      </div>

      {file && (
        <div className="mt-3 flex items-center justify-between rounded-lg border border-border bg-bg-subtle/50 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent/10 ring-1 ring-inset ring-accent/20">
              {mode === "image" ? (
                <FileImage className="h-3.5 w-3.5 text-accent" />
              ) : (
                <FileVideo className="h-3.5 w-3.5 text-accent" />
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-xs text-text">{file.name}</p>
              <p className="font-mono text-[10px] text-text-faint">{formatBytes(file.size)}</p>
            </div>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onFileSelected(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
            className="shrink-0 rounded-md p-1 text-text-faint hover:bg-bg-subtle hover:text-text"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
