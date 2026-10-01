import { render, screen } from "@testing-library/react";
import { getServiceEquipmentIcon, getServiceEquipmentSubtypeLabel, isPresetServiceEquipmentSubtype } from "./ServiceEquipmentIcon";
import { ServiceEquipmentChip } from "./ServiceEquipmentChip";

describe("service equipment visuals", () => {
  it.each([
    ["wireless-beltpack", "Wireless beltpack"],
    ["wired-beltpack", "Wired beltpack"],
    ["personal-monitor", "Personal monitor"],
  ])("maps %s to a friendly label", (subtype, label) => {
    expect(getServiceEquipmentSubtypeLabel(subtype)).toBe(label);
    expect(isPresetServiceEquipmentSubtype(subtype)).toBe(true);
  });

  it("keeps unknown subtype text available as a custom value", () => {
    const subtype = "Auracast receiver";
    expect(isPresetServiceEquipmentSubtype(subtype)).toBe(false);
    expect(getServiceEquipmentSubtypeLabel(subtype)).toBe(subtype);
    expect(getServiceEquipmentIcon({ subtype })).toBeDefined();
  });

  it("renders an IEM assignment with its color icon and subtype", () => {
    render(
      <ServiceEquipmentChip equipment={{
        id: "iem-1",
        category: "iem",
        name: "Blue",
        subtype: "wireless-beltpack",
        color: "#2255cc",
      }} />,
    );

    expect(screen.getByLabelText("Blue · Wireless beltpack")).toBeInTheDocument();
  });
});
