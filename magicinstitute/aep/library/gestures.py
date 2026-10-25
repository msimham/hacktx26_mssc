"""How each gesture is performed. Shared by the agents' prompts; the player has the matching recogniser (web/gestures.js)."""
from __future__ import annotations

HOWTO = {
    "grab": "make a tight fist, held briefly", "squeeze": "make a tight fist and hold it firmly for about a second",
    "point": "extend only the index finger", "open_palm": "spread all five fingers, palm to the camera", "thumbs_up": "fist with the thumb up",
    "peace": "extend index and middle finger in a V", "phone": "extend thumb and little finger, like a phone",
    "pinch": "touch thumb and index fingertips together",
    "pull": "pinch or make a fist, then pull the hand DOWN", "push": "open palm, then push it toward the screen",
    "lift": "make a fist, then raise it UP", "sweep": "closed fist swept side to side", "wave": "open hand swung side to side",
    "swipe": "open hand flicked quickly in one direction", "trace": "index finger drawn steadily across", "circle": "index finger drawing a circle",
}
# Prefer the gesture that mirrors the real-world motion of the step
GUIDANCE = ("Choose the gesture that MIRRORS the real motion: pulling a pin/handle/tape = pull; pushing a door or shield = push; "
            "sweeping a nozzle = sweep; lifting/raising = lift; holding a lever or rail = squeeze/grab; drawing a route = trace; "
            "encircling/wrapping = circle; calling for help = phone; 'two of something' = peace; confirming = thumbs_up; "
            "inspecting/testing = open_palm; indicating = point. Use static poses only when the real action is a static grip or sign.")
