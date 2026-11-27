"""Turns a stream of postures into fall events, one camera at a time."""

from dataclasses import dataclass
from typing import Optional

UPRIGHT = {"standing", "sitting"}


@dataclass
class FallTracker:
    transition_s: float
    confirm_s: float
    last_upright_at: Optional[float] = None
    lying_since: Optional[float] = None
    sudden: bool = False
    reported: bool = False

    def update(self, now: float, posture: Optional[str]) -> bool:
        """Feed the main person's posture (None = nobody in view). True once per fall."""
        if posture in UPRIGHT:
            self.last_upright_at = now
            self.lying_since = None
            self.reported = False
            return False
        if posture != "lying":
            # Nobody / unclear: keep the lying timer, a fallen person is often half out of view.
            return False
        if self.lying_since is None:
            self.lying_since = now
            # A fall goes from upright to lying in a moment; lying down on a bed takes longer.
            self.sudden = self.last_upright_at is not None and now - self.last_upright_at <= self.transition_s
        if self.sudden and not self.reported and now - self.lying_since >= self.confirm_s:
            self.reported = True
            return True
        return False
