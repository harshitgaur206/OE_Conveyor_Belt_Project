"""Generic, orientation-agnostic bag counting by line crossing.

Doesn't assume any fixed belt geometry. In "auto" mode (the default) it
watches tracked bags for a short calibration window and derives two things
from what it actually observes, not from the frame's geometry: the dominant
travel direction (from net displacement) and where to anchor the line (the
centroid of observed bag positions, not the frame's geometric center — a
belt often occupies only a corner or edge of the frame, e.g. an overhead
camera covering a wider area than just the belt, and a line through the
frame center would sit in empty space, never crossed). This works for a
belt running left-right, top-bottom, or at an angle, anywhere in frame, on
any camera placement, without per-site tuning. Explicit "horizontal"/
"vertical" modes skip calibration for an installation where the orientation
is already known and you want counting active from frame 1 — those still
use frame-fraction positioning since there's no observed data yet to anchor
to.
"""

import math
from dataclasses import dataclass, field

Point = tuple[float, float]


@dataclass
class _TrackState:
    hits: int = 0
    last_center: Point | None = None
    counted: bool = False
    # Positions seen while the line is still calibrating, so a bag that
    # fully crosses during that warm-up window can be counted retroactively
    # once the line locks, instead of being silently missed. Cleared (left
    # empty) once locked — not needed for the live incremental check.
    history: list[Point] = field(default_factory=list)


class LineCounter:
    def __init__(
        self,
        orientation: str = "auto",
        line_fraction: float = 0.5,
        calibration_min_samples: int = 20,
        min_hit_streak: int = 3,
    ):
        self.orientation = orientation
        self.line_fraction = line_fraction
        self.calibration_min_samples = calibration_min_samples
        self.min_hit_streak = min_hit_streak

        self._tracks: dict[int, _TrackState] = {}
        self._direction: Point | None = None
        self._reference: Point | None = None
        self._calib_sum: list[float] = [0.0, 0.0]  # net displacement, for direction
        self._calib_samples = 0
        self._position_sum: list[float] = [0.0, 0.0]  # observed positions, for anchor point
        self._position_samples = 0
        self.count = 0

    @property
    def is_calibrating(self) -> bool:
        return self._direction is None

    def reset(self) -> None:
        self._tracks.clear()
        self._direction = None
        self._reference = None
        self._calib_sum = [0.0, 0.0]
        self._calib_samples = 0
        self._position_sum = [0.0, 0.0]
        self._position_samples = 0
        self.count = 0

    def _lock(self, width: int, height: int) -> None:
        if self.orientation == "horizontal":
            self._direction = (0.0, 1.0)
            self._reference = (width / 2.0, height * self.line_fraction)
        elif self.orientation == "vertical":
            self._direction = (1.0, 0.0)
            self._reference = (width * self.line_fraction, height / 2.0)
        else:
            dx, dy = self._calib_sum
            norm = math.hypot(dx, dy)
            # No clear net movement observed (empty scene, pure jitter) —
            # fall back to a vertical-travel assumption rather than
            # stalling calibration forever.
            self._direction = (dx / norm, dy / norm) if norm > 1e-6 else (0.0, 1.0)
            # Anchor through where bags were actually observed, not the
            # frame's geometric center — the belt may only occupy one
            # corner/edge of a wider camera view.
            if self._position_samples > 0:
                self._reference = (
                    self._position_sum[0] / self._position_samples,
                    self._position_sum[1] / self._position_samples,
                )
            else:
                self._reference = (width / 2.0, height / 2.0)

    def _has_crossed(self, prev: Point, curr: Point) -> bool:
        ux, uy = self._direction
        rx, ry = self._reference
        s_prev = (prev[0] - rx) * ux + (prev[1] - ry) * uy
        s_curr = (curr[0] - rx) * ux + (curr[1] - ry) * uy
        return s_prev * s_curr < 0

    def _replay_calibration_history(self) -> None:
        """Called right after the line locks. A bag can fully cross the
        belt during the calibration warm-up, before any line exists to
        cross — without this, that bag is silently never counted. Every
        track's positions were recorded during calibration (see update()),
        so replay each one against the now-known line to catch crossings
        that already happened.
        """
        for state in self._tracks.values():
            if not state.counted and len(state.history) >= 2:
                for i in range(1, len(state.history)):
                    if (i + 1) < self.min_hit_streak:
                        continue
                    if self._has_crossed(state.history[i - 1], state.history[i]):
                        state.counted = True
                        self.count += 1
                        break
            state.history = []

    def update(
        self,
        width: int,
        height: int,
        track_ids: list[int],
        centers: list[Point],
    ) -> None:
        """Feed one frame's (track_id, center) pairs; updates self.count."""
        explicit_orientation = self.orientation in ("horizontal", "vertical")
        if explicit_orientation and self._direction is None:
            self._lock(width, height)

        for track_id, center in zip(track_ids, centers):
            state = self._tracks.setdefault(track_id, _TrackState())
            state.hits += 1
            prev = state.last_center

            if self._direction is None:
                state.history.append(center)
                self._position_sum[0] += center[0]
                self._position_sum[1] += center[1]
                self._position_samples += 1
                if prev is not None:
                    self._calib_sum[0] += center[0] - prev[0]
                    self._calib_sum[1] += center[1] - prev[1]
                    self._calib_samples += 1
                state.last_center = center
                if self._calib_samples >= self.calibration_min_samples:
                    self._lock(width, height)
                    self._replay_calibration_history()
                continue

            if (
                prev is not None
                and not state.counted
                and state.hits >= self.min_hit_streak
                and self._has_crossed(prev, center)
            ):
                state.counted = True
                self.count += 1

            state.last_center = center

    def line_endpoints(self, width: int, height: int) -> tuple[tuple[int, int], tuple[int, int]] | None:
        """Two points describing the counting line for overlay drawing, or
        None while orientation is still being auto-calibrated."""
        if self._direction is None or self._reference is None:
            return None
        ux, uy = self._direction
        px, py = -uy, ux  # perpendicular to travel direction
        rx, ry = self._reference
        span = max(width, height) * 2
        p1 = (int(rx + px * span), int(ry + py * span))
        p2 = (int(rx - px * span), int(ry - py * span))
        return p1, p2
