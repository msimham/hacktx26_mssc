import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { App } from "./App";

afterEach(cleanup);

describe("App", () => {
  it("seeds the wizard from a starting point on the landing page", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    );
    await user.click(screen.getByRole("button", { name: /Fire safety.*Use this/s }));
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("Fire safety");
    expect((screen.getByRole("button", { name: "Continue" }) as HTMLButtonElement).disabled).toBe(false);
  });
});
