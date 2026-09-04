"use client";

import { useState } from "react";
import { clsx } from "clsx";
import {
  Play,
  Loader2,
  Wifi,
  CheckCircle2,
  XCircle,
  Image as ImageIcon,
  Film,
  Radio,
  Square,
  Camera,
  Router,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UploadZone } from "@/components/UploadZone";
import { ApiError, checkStreamSource } from "@/lib/api";
import type { DetectionMode, LiveSource } from "@/types/detection";

interface ControlPanelProps {
  mode: DetectionMode;
  onModeChange: (mode: DetectionMode) => void;
  file: File | null;
  onFileSelected: (file: File | null) => void;
  liveSource: LiveSource;
  onLiveSourceChange: (source: LiveSource) => void;
  rtspUrl: string;
  onRtspUrlChange: (url: string) => void;
  onRunDetection: () => void;
  isRunning: boolean;
  isStreaming: boolean;
  onStopStream: () => void;
  disabled: boolean;
}

const modes: { value: DetectionMode; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { value: "image", label: "Image", icon: ImageIcon },
  { value: "video", label: "Video", icon: Film },
  { value: "webcam", label: "Live", icon: Radio },
];

type TestState = "idle" | "checking" | "ok" | "error";

export function ControlPanel({
  mode,
  onModeChange,
  file,
  onFileSelected,
  liveSource,
  onLiveSourceChange,
  rtspUrl,
  onRtspUrlChange,
  onRunDetection,
  isRunning,
  isStreaming,
  onStopStream,
  disabled,
}: ControlPanelProps) {
  const [testState, setTestState] = useState<TestState>("idle");
  const [testMessage, setTestMessage] = useState("");
  const canRun = mode === "webcam" ? !isStreaming : Boolean(file) && !isRunning;

  const handleTestConnection = async () => {
    setTestState("checking");
    try {
      const result = await checkStreamSource(rtspUrl);
      if (result.opened && result.frame_read) {
        setTestState("ok");
        setTestMessage(`${result.width}×${result.height} @ ${result.fps.toFixed(0)}fps`);
      } else if (result.opened) {
        setTestState("error");
        setTestMessage("Connected, but couldn't read a frame (unsupported codec/transport?)");
      } else {
        setTestState("error");
        setTestMessage("Could not open this source — check URL, network, and credentials");
      }
    } catch (error) {
      setTestState("error");
      setTestMessage(error instanceof ApiError ? error.message : "Test failed unexpectedly");
      toast.error("Backend unreachable. Please check the server.");
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Control Panel</CardTitle>
        {isStreaming && (
          <span className="flex items-center gap-1.5 font-mono text-[10px] font-medium uppercase tracking-wider text-red-400">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
            Live
          </span>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-white/10 bg-black/20 p-1.5">
          {modes.map((m) => {
            const Icon = m.icon;
            const active = mode === m.value;
            return (
              <button
                key={m.value}
                onClick={() => onModeChange(m.value)}
                className={clsx(
                  "flex flex-col items-center gap-1.5 rounded-lg px-2 py-2.5 text-xs font-medium transition-all duration-200",
                  active
                    ? "bg-gradient-to-b from-emerald-500/20 to-cyan-500/10 text-emerald-300 ring-1 ring-inset ring-emerald-400/30 shadow-[0_0_16px_-4px_rgba(16,185,129,0.5)]"
                    : "text-slate-500 hover:bg-white/5 hover:text-slate-300"
                )}
              >
                <Icon className="h-4 w-4" />
                {m.label}
              </button>
            );
          })}
        </div>

        {mode !== "webcam" ? (
          <UploadZone mode={mode} file={file} onFileSelected={onFileSelected} />
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-white/10 bg-black/20 p-1.5">
              {(
                [
                  { value: "browser" as const, label: "This Device", icon: Camera },
                  { value: "network" as const, label: "Network / RTSP", icon: Router },
                ]
              ).map((s) => {
                const Icon = s.icon;
                const active = liveSource === s.value;
                return (
                  <button
                    key={s.value}
                    onClick={() => !isStreaming && onLiveSourceChange(s.value)}
                    disabled={isStreaming}
                    className={clsx(
                      "flex items-center justify-center gap-1.5 rounded-lg px-2 py-2 text-xs font-medium transition-all duration-200 disabled:cursor-not-allowed disabled:opacity-60",
                      active
                        ? "bg-gradient-to-b from-emerald-500/20 to-cyan-500/10 text-emerald-300 ring-1 ring-inset ring-emerald-400/30"
                        : "text-slate-500 hover:bg-white/5 hover:text-slate-300"
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {s.label}
                  </button>
                );
              })}
            </div>

            {liveSource === "browser" ? (
              <p className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2.5 text-xs text-slate-500">
                Uses <span className="text-slate-300">this device&apos;s own camera</span> — captured in your
                browser and streamed to the backend for detection. Requires camera permission and HTTPS (or
                localhost).
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <label className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
                  RTSP Source <span className="text-slate-700">{"// optional"}</span>
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={rtspUrl}
                    onChange={(e) => {
                      onRtspUrlChange(e.target.value);
                      setTestState("idle");
                    }}
                    disabled={isStreaming}
                    placeholder="rtsp://user:pass@192.168.1.50:554/stream"
                    className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 font-mono text-xs text-slate-200 placeholder:text-slate-700 focus:border-emerald-400/50 focus:outline-none focus:ring-1 focus:ring-emerald-400/30 disabled:opacity-50"
                  />
                  <Button
                    variant="outline"
                    onClick={handleTestConnection}
                    disabled={!rtspUrl || testState === "checking" || isStreaming}
                    className="px-3"
                  >
                    {testState === "checking" ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Wifi className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                {testState === "ok" && (
                  <p className="flex items-center gap-1.5 font-mono text-[11px] text-emerald-400">
                    <CheckCircle2 className="h-3.5 w-3.5" /> reachable · {testMessage}
                  </p>
                )}
                {testState === "error" && (
                  <p className="flex items-center gap-1.5 text-xs text-red-400">
                    <XCircle className="h-3.5 w-3.5 shrink-0" /> {testMessage}
                  </p>
                )}
                {!rtspUrl && (
                  <p className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2.5 text-xs text-slate-500">
                    No RTSP source set — streams the <span className="text-slate-300">backend&apos;s</span> local
                    webcam instead.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {mode === "webcam" && isStreaming ? (
          <Button variant="secondary" onClick={onStopStream}>
            <Square className="h-3.5 w-3.5 fill-current" />
            Stop Stream
          </Button>
        ) : (
          <Button onClick={onRunDetection} disabled={!canRun || disabled}>
            {isRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4 fill-current" />}
            Run Detection
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
