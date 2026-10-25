import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CreateTraining } from "./CreateTraining";
import { initialState, reducer } from "./create/state";
import { categoryProgress } from "./create/categories";
import { emptyAnswers, STEPS } from "./create/steps";

afterEach(cleanup);

const setup = () => render(<CreateTraining />);

describe("reducer", () => {
  it("appends chips with a separator and clamps navigation", () => {
    let s = reducer(initialState(), { type: "append", id: "train", text: "Fire safety" });
    s = reducer(s, { type: "append", id: "train", text: "Onboarding" });
    expect(s.answers.train).toBe("Fire safety, Onboarding");
    expect(reducer(initialState(), { type: "back" }).index).toBe(0);
    expect(reducer(initialState(), { type: "goto", index: 99 }).index).toBe(STEPS.length);
  });
});

describe("categoryProgress", () => {
  it("fills a category in proportion to its answered questions", () => {
    const progress = categoryProgress({ ...emptyAnswers(), train: "Fire safety" });
    expect(progress.find((p) => p.id === "goal")?.done).toBe(0.5);
    expect(progress.find((p) => p.id === "world")?.done).toBe(0);
    expect(progress.find((p) => p.id === "world")?.firstStep).toBe(STEPS.findIndex((s) => s.id === "world"));
  });
});

describe("CreateTraining wizard", () => {
  it("keeps Continue disabled until the answer is non-blank", async () => {
    const user = userEvent.setup();
    setup();
    const next = screen.getByRole("button", { name: "Continue" });
    expect((next as HTMLButtonElement).disabled).toBe(true);
    await user.type(screen.getByRole("textbox"), "   ");
    expect((next as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole("button", { name: "+ Fire safety" }));
    expect((next as HTMLButtonElement).disabled).toBe(false);
  });

  it("walks every step, reviews, and submits", async () => {
    const user = userEvent.setup();
    const building = { id: "p1", status: "building", phases: [{ id: "understand", label: "Understanding your training goals", status: "running" }] };
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => building });
    vi.stubGlobal("fetch", fetchMock);
    setup();
    for (const step of STEPS) {
      await user.click(screen.getByRole("button", { name: `+ ${step.chips[0]}` }));
      await user.click(screen.getByRole("button", { name: "Continue" }));
    }
    expect(screen.getByText(/what you.re creating/i)).toBeTruthy();
    expect(screen.getByText(/production-ready/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Create Training Simulation Agent" }));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/training-programs");
    expect(JSON.parse(init.body).answers).toMatchObject({ train: "Team collaboration" });
    expect(await screen.findByText(/Building your training…/)).toBeTruthy();
    expect(screen.getByText("Understanding your training goals")).toBeTruthy();
    vi.unstubAllGlobals();
  });
});
