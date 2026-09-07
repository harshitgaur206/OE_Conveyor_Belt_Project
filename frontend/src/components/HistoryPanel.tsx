"use client";

import { useEffect, useState } from "react";
import {
  Loader2,
  History as HistoryIcon,
  ImageIcon,
  Film,
  Radio,
  Camera,
  X,
  Trash2,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { ApiError, deleteHistoryRecord, getHistory, mediaUrl } from "@/lib/api";
import { Button } from "@/components/ui/button";
import type { CameraSummary, HistoryRecord, HistorySourceType } from "@/types/detection";

const SOURCE_ICON: Record<HistorySourceType, React.ComponentType<{ className?: string }>> = {
  image: ImageIcon,
  video: Film,
  rtsp: Radio,
  browser: Camera,
};

function formatTimestamp(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString();
}

function formatDuration(startedAt: number, endedAt: number): string {
  const seconds = Math.max(0, endedAt - startedAt);
  if (seconds < 1) return "instant";
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

interface HistoryPanelProps {
  activeCameras: CameraSummary[];
  isBrowserCameraActive: boolean;
  onOpenLiveNetwork: () => void;
  onOpenLiveBrowser: () => void;
}

function RecordDetailModal({ record, onClose, onDeleted }: { record: HistoryRecord; onClose: () => void; onDeleted: (id: string) => void }) {
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteHistoryRecord(record.id);
      onDeleted(record.id);
      onClose();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Could not delete this record.");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col gap-4 overflow-auto rounded-2xl border border-border bg-bg-elevated p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-mono text-xs uppercase tracking-wider text-text-muted">Detection Log</h3>
          <button onClick={onClose} className="rounded p-1 text-text-faint hover:bg-bg-subtle hover:text-text">
            <X className="h-4 w-4" />
          </button>
        </div>

        {record.source_type === "video" && record.annotated_media_path ? (
          <video
            src={mediaUrl(`/media/${record.annotated_media_path}`)}
            controls
            className="w-full rounded-lg bg-black"
          />
        ) : (
          <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-border text-xs text-text-faint">
            No stored media for this record
          </div>
        )}

        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <dt className="text-text-faint">Source</dt>
          <dd className="capitalize text-text">{record.source_type}</dd>
          <dt className="text-text-faint">Name</dt>
          <dd className="truncate text-text">{record.source_name}</dd>
          <dt className="text-text-faint">Started</dt>
          <dd className="text-text">{formatTimestamp(record.started_at)}</dd>
          <dt className="text-text-faint">Duration</dt>
          <dd className="text-text">{formatDuration(record.started_at, record.ended_at)}</dd>
          <dt className="text-text-faint">Bag Count</dt>
          <dd className="font-mono text-accent">{record.bag_count}</dd>
          <dt className="text-text-faint">Avg Confidence</dt>
          <dd className="font-mono text-text">{(record.confidence_avg * 100).toFixed(1)}%</dd>
          <dt className="text-text-faint">Frames</dt>
          <dd className="text-text">{record.frame_count ?? "—"}</dd>
          <dt className="text-text-faint">ROI Used</dt>
          <dd className="text-text">{record.roi_used ? "Yes" : "No"}</dd>
        </dl>

        <div className="flex justify-end">
          <Button variant="secondary" onClick={handleDelete} disabled={deleting}>
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Delete Record
          </Button>
        </div>
      </div>
    </div>
  );
}

export function HistoryPanel({
  activeCameras,
  isBrowserCameraActive,
  onOpenLiveNetwork,
  onOpenLiveBrowser,
}: HistoryPanelProps) {
  const [records, setRecords] = useState<HistoryRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [openRecord, setOpenRecord] = useState<HistoryRecord | null>(null);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    async function load() {
      try {
        const result = await getHistory({ limit: 100, signal: controller.signal });
        if (!cancelled) {
          setRecords(result);
          setError(null);
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : "Could not load history.");
      }
    }

    load();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleDeleteSelected = async () => {
    const ids = Array.from(selectedIds);
    const results = await Promise.allSettled(ids.map((id) => deleteHistoryRecord(id)));
    const failed = results.filter((r) => r.status === "rejected").length;
    setRecords((prev) => (prev ? prev.filter((r) => !selectedIds.has(r.id)) : prev));
    setSelectedIds(new Set());
    if (failed > 0) toast.error(`${failed} record${failed === 1 ? "" : "s"} could not be deleted.`);
  };

  const handleRecordDeleted = (id: string) => {
    setRecords((prev) => (prev ? prev.filter((r) => r.id !== id) : prev));
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const hasRunning = activeCameras.length > 0 || isBrowserCameraActive;

  return (
    <div className="flex w-full flex-col gap-4">
      {hasRunning && (
        <div className="flex flex-col gap-2">
          <h3 className="font-mono text-[11px] uppercase tracking-wider text-text-faint">Currently Running</h3>
          <div className="flex flex-col gap-1.5">
            {isBrowserCameraActive && (
              <button
                onClick={onOpenLiveBrowser}
                className="flex items-center justify-between rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-left text-sm text-text hover:bg-accent/10"
              >
                <span className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                  <Camera className="h-3.5 w-3.5 text-accent" />
                  This device&apos;s camera
                </span>
                <ExternalLink className="h-3.5 w-3.5 text-text-faint" />
              </button>
            )}
            {activeCameras.map((camera) => (
              <button
                key={camera.id}
                onClick={onOpenLiveNetwork}
                className="flex items-center justify-between rounded-lg border border-accent/20 bg-accent/5 px-3 py-2 text-left text-sm text-text hover:bg-accent/10"
              >
                <span className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                  <Radio className="h-3.5 w-3.5 text-accent" />
                  {camera.name}
                </span>
                <ExternalLink className="h-3.5 w-3.5 text-text-faint" />
              </button>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-text-faint">
          <HistoryIcon className="h-8 w-8" />
          <p className="text-sm">{error}</p>
        </div>
      )}

      {!error && records === null && (
        <div className="flex flex-col items-center justify-center gap-3 p-8 text-text-faint">
          <Loader2 className="h-6 w-6 animate-spin" />
          <p className="font-mono text-xs uppercase tracking-wider">Loading history…</p>
        </div>
      )}

      {!error && records !== null && records.length === 0 && !hasRunning && (
        <div className="flex flex-col items-center justify-center gap-2 p-8 text-center text-text-faint">
          <HistoryIcon className="h-8 w-8" />
          <p className="font-mono text-xs uppercase tracking-wider">No detections recorded yet</p>
        </div>
      )}

      {!error && records !== null && records.length > 0 && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h3 className="font-mono text-[11px] uppercase tracking-wider text-text-faint">Past Detections</h3>
            {selectedIds.size > 0 && (
              <Button variant="secondary" onClick={handleDeleteSelected} className="px-3 py-1.5 text-xs">
                <Trash2 className="h-3.5 w-3.5" />
                Delete Selected ({selectedIds.size})
              </Button>
            )}
          </div>
          <div className="w-full overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead>
                <tr className="border-b border-border text-[11px] uppercase tracking-wider text-text-faint">
                  <th className="w-8 py-2"></th>
                  <th className="py-2 pr-4 font-medium">Source</th>
                  <th className="py-2 pr-4 font-medium">Name</th>
                  <th className="py-2 pr-4 font-medium">When</th>
                  <th className="py-2 pr-4 font-medium">Duration</th>
                  <th className="py-2 pr-4 font-medium">Bags</th>
                  <th className="py-2 pr-4 font-medium">Confidence</th>
                  <th className="py-2 font-medium">ROI</th>
                </tr>
              </thead>
              <tbody>
                {records.map((record) => {
                  const Icon = SOURCE_ICON[record.source_type];
                  return (
                    <tr
                      key={record.id}
                      className="cursor-pointer border-b border-border/60 text-text-muted hover:bg-bg-subtle/40"
                      onClick={() => setOpenRecord(record)}
                    >
                      <td className="py-2" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(record.id)}
                          onChange={() => toggleSelected(record.id)}
                          className="accent-accent"
                        />
                      </td>
                      <td className="py-2 pr-4">
                        <span className="flex items-center gap-1.5">
                          <Icon className="h-3.5 w-3.5 text-accent" />
                          <span className="capitalize">{record.source_type}</span>
                        </span>
                      </td>
                      <td className="max-w-[180px] truncate py-2 pr-4">{record.source_name}</td>
                      <td className="py-2 pr-4 font-mono text-xs text-text-faint">
                        {formatTimestamp(record.started_at)}
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs text-text-faint">
                        {formatDuration(record.started_at, record.ended_at)}
                      </td>
                      <td className="py-2 pr-4 font-mono text-accent">{record.bag_count}</td>
                      <td className="py-2 pr-4 font-mono text-xs text-text-faint">
                        {(record.confidence_avg * 100).toFixed(1)}%
                      </td>
                      <td className="py-2 text-xs">
                        {record.roi_used ? (
                          <span className="text-accent">Yes</span>
                        ) : (
                          <span className="text-text-faint">No</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {openRecord && (
        <RecordDetailModal
          record={openRecord}
          onClose={() => setOpenRecord(null)}
          onDeleted={handleRecordDeleted}
        />
      )}
    </div>
  );
}
