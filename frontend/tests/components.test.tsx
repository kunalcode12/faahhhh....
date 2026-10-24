import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import { ErrorPanel } from "@/components/ui/error-panel";
import { Segmented } from "@/components/ui/segmented";
import { Stat } from "@/components/ui/stat";
import { ApiError } from "@/lib/api/errors";

describe("ErrorPanel", () => {
  it("explains the failure, offers a retry and shows the request reference", async () => {
    const onRetry = vi.fn();
    const error = new ApiError({
      message: "Could not reach the server.",
      code: "network_error",
      requestId: "abc123def456789",
    });
    render(<ErrorPanel error={error} onRetry={onRetry} />);

    expect(screen.getByRole("alert")).toHaveTextContent("Can't reach the server");
    expect(screen.getByText("abc123def456")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("disables the button while retrying", () => {
    render(<ErrorPanel error={new Error("boom")} onRetry={() => {}} retrying />);
    expect(screen.getByRole("button", { name: "Retrying…" })).toBeDisabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
  });
});

function GatePicker() {
  const [value, setValue] = useState("0950");
  return (
    <Segmented
      label="Auction gate"
      value={value}
      onChange={setValue}
      options={[
        { value: "0920", label: "EPEX 60-min" },
        { value: "0950", label: "N2EX" },
        { value: "1530", label: "EPEX 30-min" },
      ]}
    />
  );
}

describe("Segmented", () => {
  it("behaves as a radio group: one tab stop, arrow keys move the choice", async () => {
    render(<GatePicker />);
    const group = screen.getByRole("radiogroup", { name: "Auction gate" });
    const radios = screen.getAllByRole("radio");
    expect(group).toBeInTheDocument();
    expect(radios.map((r) => r.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"]);

    radios[1].focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "EPEX 30-min" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "EPEX 30-min" })).toHaveFocus();

    await userEvent.keyboard("{ArrowRight}"); // wraps around
    expect(screen.getByRole("radio", { name: "EPEX 60-min" })).toHaveAttribute("aria-checked", "true");

    await userEvent.click(screen.getByRole("radio", { name: "N2EX" }));
    expect(screen.getByRole("radio", { name: "N2EX" })).toHaveAttribute("aria-checked", "true");
  });
});

describe("Stat", () => {
  it("renders label, value and detail", () => {
    render(<Stat label="Bias" value="+1.7 GW" detail="Too high in 84% of hours." series="forecast" />);
    expect(screen.getByText("Bias")).toBeInTheDocument();
    expect(screen.getByText("+1.7 GW")).toBeInTheDocument();
    expect(screen.getByText("Too high in 84% of hours.")).toBeInTheDocument();
  });
});
