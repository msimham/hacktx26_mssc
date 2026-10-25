"""Curated skills: ordered, commonly taught procedures. The scenario is built to teach exactly these.

Not certified by any authority; the spec carries a disclaimer. Have a subject-matter expert review before real use.
Every step has a plain second-person `line` ("What would you do? You should ..."): the learner IS the heroine, addressed as "you", with no fluff.
Gestures are chosen to mirror the real motion (pull a pin = PULL, sweep the nozzle = SWEEP, push a door = PUSH).
"""
from __future__ import annotations

from aep.schema import Skill, SkillStep


def S(id, name, action, why, gesture, kind, voice):
    return SkillStep(id=id, name=name, action=action, why=why, gesture=gesture, prop_kind=kind, line=voice)


FIRE = [
    Skill(id="extinguisher", level=1, name="Use a fire extinguisher (PASS)",
          goal="Put out a small fire safely, or know when to leave instead.",
          source_url="https://www.nfpa.org/education-and-research/home-fire-safety",
          steps=[
              S("assess", "Size up the fire", "Check the fire is small and your exit is behind you. Point to your escape route.",
                "Only fight a fire that is small and not spreading, with a clear exit at your back. Otherwise leave and call emergency services.", "point", "exit_sign",
                "What do you check before fighting a fire? Your way out. Point to the exit."),
              S("alert", "Raise the alarm", "Grip the alarm handle and pull it down.",
                "Alert others and make sure emergency services are called before or as you fight it.", "pull", "alarm",
                "Who needs to know? Everyone. Pull the fire alarm down."),
              S("fetch", "Grab the extinguisher", "Close your fist around the extinguisher.",
                "Know where extinguishers are before you need one, and pick the right type for the fire.", "grab", "extinguisher",
                "What do you need next? An extinguisher. Grab it."),
              S("pull", "Pull the pin", "Pinch the pin and pull it down and out.",
                "PASS step 1, Pull: the pin locks the handle; pulling it arms the extinguisher.", "pull", "extinguisher",
                "How do you arm it? Pull the pin down and out."),
              S("aim", "Aim at the base", "Point the nozzle at the BASE of the fire.",
                "PASS step 2, Aim: target the base where the fuel is, not the tops of the flames.", "point", "fire",
                "Where do you aim? At the base of the fire, not the flames. Point the nozzle low."),
              S("squeeze", "Squeeze the handle", "Squeeze your fist and hold it to discharge.",
                "PASS step 3, Squeeze: squeeze the handle to release the agent, standing a safe distance back.", "squeeze", "fire",
                "How do you release it? Squeeze the handle and hold it."),
              S("sweep", "Sweep side to side", "Sweep your closed hand side to side across the base.",
                "PASS step 4, Sweep: sweep side to side until the fire is out.", "sweep", "fire",
                "How do you put it out? Sweep side to side across the base."),
              S("verify", "Watch, then back out", "Give a thumbs-up once it stays out.",
                "Watch for re-ignition and back away facing the fire. If it grows or you run out, leave immediately.", "thumbs_up", "fire",
                "How do you know it is safe? Watch the fire. If it stays out, give a thumbs-up and back away."),
          ]),
    Skill(id="blanket", level=2, name="Rescue a friend with a fire blanket",
          goal="Smother flames on a person or a small pan fire with a fire blanket.",
          steps=[
              S("pull_tapes", "Pull the blanket free", "Pinch the tapes and pull the blanket down out of its pouch.",
                "Fire blankets hang in a quick-release pouch; pull both tapes straight down.", "pull", "blanket",
                "What smothers the flames? The fire blanket. Pull the tapes down to free it."),
              S("shield", "Shield your hands", "Push your open palm forward, holding the blanket wide.",
                "Fold the top edge over your hands so they are protected while you approach.", "push", "blanket",
                "How do you protect your hands? Hold the blanket open in front of you. Push your palm forward."),
              S("wrap", "Wrap them up", "Draw a circle around your friend to wrap the blanket around them, head to toe.",
                "Wrap completely to cut off oxygen, keeping their face clear. Lay them on the ground; do not rub or let them run.", "circle", "npc",
                "How do you put out the flames on your friend? Wrap the blanket around them. Draw a circle."),
              S("call", "Call for help", "Make a phone gesture (thumb and pinky out) to call emergency services.",
                "Burns need medical care even when they look minor. Call emergency services.", "phone", "phone",
                "What must you do next? Call emergency services. Make a phone gesture."),
          ]),
    Skill(id="evacuate", level=3, name="Evacuate together",
          goal="Get everyone out by a planned route and account for them.",
          source_url="https://www.ready.gov/home-fires",
          steps=[
              S("plan", "Trace your way out", "Trace your escape route across the floor plan.",
                "Know two exits from every room and rehearse the route.", "trace", "map_table",
                "Do you know your way out? Trace your escape route on the floor plan."),
              S("twoways", "Mark a second exit", "Show a peace sign: two ways out.",
                "If the first way out is blocked by fire or smoke, you need a second.", "peace", "exit_sign",
                "What if that way is blocked? Know a second exit. Show a peace sign."),
              S("feel", "Check the door", "Hold your open palm toward the door to test it for heat.",
                "Feel the door with the back of your hand; if it is hot, keep it shut and use another way out.", "open_palm", "door",
                "Is it safe to open the door? Check for heat first. Hold your open palm to the door."),
              S("open", "Open it slowly", "Push the door open slowly.",
                "Open a cool door slowly and stay low. If smoke pours in, close it and use your second exit.", "push", "door",
                "The door is cool. Open it slowly and stay low. Push it open."),
              S("stairs", "Take the stairs, low", "Grab the stair rail and head down.",
                "Use stairs, never elevators. Stay low under smoke.", "grab", "stairs",
                "How do you go down? Use the stairs, never the elevator. Grab the rail."),
              S("meet", "Go to the meeting spot", "Wave to your neighbors at the safe spot.",
                "Meet at a set place outside so everyone can see you are out.", "wave", "assembly_point",
                "Where do you go? To the meeting spot. Wave to your neighbors."),
              S("call", "Call from safety", "Make a phone gesture to call emergency services.",
                "Call emergency services from a safe place and give your address.", "phone", "phone",
                "Who do you call from outside? Emergency services. Make a phone gesture."),
              S("count", "Count heads, never go back", "Give a thumbs-up when everyone is counted.",
                "Tell the fire crew who is missing. Never re-enter a burning building.", "thumbs_up", "npc",
                "What do you do last? Count everyone, and never go back in. Give a thumbs-up when all are accounted for."),
          ]),
]

FIRE_HOOKS = {
    "extinguisher": "You are {who}. A candle has tipped over and a small fire is spreading across the room. You are alone, and the fire is still small. What would you do?",
    "blanket": "Smoke is filling the hall and your friend is in trouble. What would you do?",
    "evacuate": "The fire is too big to fight. Everyone has to get out. What would you do?",
}

CURATED = {"fire": (["fire", "burn", "smoke", "evacuat"], FIRE)}


def for_topic(topic: str) -> list[Skill] | None:
    t = topic.lower()
    for words, skills in CURATED.values():
        if any(w in t for w in words):
            return [s.model_copy(deep=True) for s in skills]
    return None
