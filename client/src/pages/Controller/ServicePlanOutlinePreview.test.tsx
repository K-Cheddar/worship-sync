import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureStore, type UnknownAction } from "@reduxjs/toolkit";
import { Provider } from "react-redux";
import allDocsReducer, { hydrateItemCache } from "../../store/allDocsSlice";
import type { DBItem, ServiceItem } from "../../types";
import type { ServicePlan } from "../../types/servicePlan";
import { plainTextToRichText } from "../../types/richText";
import ServicePlanOutlinePreview from "./ServicePlanOutlinePreview";

it("starts collapsed and follows native outline/library updates without mutating presentation content", async () => {
  const plan: ServicePlan = {
    planId: "plan", churchId: "church", planKey: "service@2026-10-27",
    serviceId: "service", date: "2026-10-27", name: "Service",
    sections: [{ id: "worship", name: "Worship", elements: [{
      id: "song", type: "song", title: plainTextToRichText("Song"),
      songRef: { kind: "library", songId: "library-song", songName: "Song" },
    }] }],
  };
  type OutlineState = { present: { itemList: { list: ServiceItem[] } } };
  const outlineReducer = (
    state: OutlineState = { present: { itemList: { list: [] } } },
    action: UnknownAction,
  ): OutlineState => action.type === "test/outline"
    ? { present: { itemList: { list: action.payload as ServiceItem[] } } }
    : state;
  const store = configureStore({ reducer: {
    allDocs: allDocsReducer, undoable: outlineReducer,
  } });
  const { rerender } = render(<Provider store={store}><ServicePlanOutlinePreview plan={plan} /></Provider>);
  const toggle = screen.getByRole("button", { name: /Outline preview/ });
  expect(toggle).toHaveAttribute("aria-expanded", "false");
  expect(screen.queryByText(/Unresolved attachment/)).not.toBeInTheDocument();
  await userEvent.setup().click(toggle);
  expect(screen.getByText(/Unresolved attachment/)).toBeInTheDocument();
  const song: ServiceItem = { _id: "library-song", name: "Song", type: "song", listId: "library" };
  const songDoc: DBItem = {
    _id: song._id, name: song.name, type: "song", slides: [], arrangements: [], selectedArrangement: 0,
    shouldSendTo: { projector: false, monitor: false, stream: false },
  };
  act(() => { store.dispatch(hydrateItemCache([songDoc])); });
  expect(screen.getByText(/Ready to add: End of outline/)).toBeInTheDocument();
  expect(store.getState().undoable.present.itemList.list).toEqual([]);
  act(() => { store.dispatch({ type: "test/outline", payload: [{ ...song, listId: "song::attachment:legacy-song-0-library" }] }); });
  expect(screen.getByText(/Already in outline/)).toBeInTheDocument();
  const updated = { ...plan, sections: [{ ...plan.sections[0], elements: [] }] };
  rerender(<Provider store={store}><ServicePlanOutlinePreview plan={updated} /></Provider>);
  expect(screen.getByText("No outline attachments in this plan.")).toBeInTheDocument();
  expect(store.getState().undoable.present.itemList.list).toHaveLength(1);
});
