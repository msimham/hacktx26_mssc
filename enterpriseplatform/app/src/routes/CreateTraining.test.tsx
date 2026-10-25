import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { CreateTraining } from "./CreateTraining";
import { initialState, reducer } from "./create/state";
import { STEPS } from "./create/steps";

afterEach(cleanup);

const setup = () =>
  render(
    <MemoryRouter>
      <CreateTraining />
    </MemoryRouter>,
  );

describe("reducer", () => {
  it("appends chips with a separator and clamps navigation", () => {
    let s = reducer(initialState(), { type: "append", id: "train", text: "Fire safety" });
    s = reducer(s, { type: "append", id: "train", text: "Onboarding" });
    expect(s.answers.train).toBe("Fire safety, Onboarding");
    expect(reducer(initialState(), { type: "back" }).index).toBe(0);
    expect(reducer(initialState(), { type: "goto", index: 99 }).index).toBe(STEPS.length);
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
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    setup();
    for (const step of STEPS) {
      await user.click(screen.getByRole("button", { name: `+ ${step.chips[0]}` }));
      await user.click(screen.getByRole("button", { name: "Continue" }));
    }
    expect(screen.getByText(/what you.re creating/i)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Create Training" }));
    expect(log).toHaveBeenCalledWith(expect.objectContaining({ train: "Team collaboration" }));
    expect(await screen.findByRole("status")).toBeTruthy();
    log.mockRestore();
  });
});
