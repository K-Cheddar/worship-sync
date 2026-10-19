import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { configureStore } from "@reduxjs/toolkit";
import { MemoryRouter } from "react-router-dom";
import "../src/index.css";
import FloatingWindow from "../src/components/FloatingWindow/FloatingWindow";
import { FloatingWindowZIndexProvider } from "../src/components/FloatingWindow/FloatingWindowZIndexContext";
import ControllerServicePlanView from "../src/pages/Controller/ControllerServicePlanView";
import allDocsReducer from "../src/store/allDocsSlice";
import controllerProfilesReducer from "../src/store/controllerProfilesSlice";
import { plainTextToRichText } from "../src/types/richText";
import type { ServicePlan, ServicePlanElement } from "../src/types/servicePlan";

const store = configureStore({
  reducer: {
    allDocs: allDocsReducer,
    controllerProfiles: controllerProfilesReducer,
  },
});

const makeElement = (id: string, title: string): ServicePlanElement => ({
  id,
  type: "free",
  title: plainTextToRichText(title),
  notes: plainTextToRichText(`Operator note for ${title}`),
  durationSeconds: 60,
  assignees: [],
  teamNotes: [],
  resources: [],
});

const makePlan = (): ServicePlan => ({
  planId: "scroll-test-plan",
  churchId: "scroll-test-church",
  planKey: "scroll-test-service@2026-10-19",
  serviceId: "scroll-test-service",
  date: "2026-10-19",
  startsAt: "2026-10-19T18:00:00.000Z",
  name: "Scroll Test Service",
  revision: 1,
  sections: [{
    id: "order-of-worship",
    name: "Order of Worship",
    elements: Array.from({ length: 48 }, (_, index) => {
      const number = index + 1;
      return makeElement(`item-${number}`, `Plan item ${number}`);
    }),
  }],
});

const App = () => {
  const [plan, setPlan] = useState(makePlan);

  useEffect(() => {
    window.applyServicePlanRefresh = () => {
      setPlan((current) => ({
        ...current,
        revision: (current.revision || 0) + 1,
        sections: current.sections.map((section) => ({
          ...section,
          elements: [
            makeElement("inserted-item", "Inserted plan item"),
            ...section.elements.filter((element) => element.id !== "inserted-item"),
          ],
        })),
      }));
    };
    window.removeServicePlanItem = (itemId) => {
      setPlan((current) => ({
        ...current,
        revision: (current.revision || 0) + 1,
        sections: current.sections.map((section) => ({
          ...section,
          elements: section.elements.filter((element) => element.id !== itemId),
        })),
      }));
    };
    return () => {
      delete window.applyServicePlanRefresh;
      delete window.removeServicePlanItem;
    };
  }, []);

  return (
    <Provider store={store}>
      <MemoryRouter initialEntries={["/controller/service-planning"]}>
        <FloatingWindowZIndexProvider>
          <FloatingWindow
            title="Service Plan"
            onClose={() => undefined}
            defaultPosition={{ x: 24, y: 24 }}
            defaultWidth={560}
            defaultHeight={420}
            autoHeight
            resizable={false}
          >
            <ControllerServicePlanView
              key={`scroll-test-church:presentation:${plan.planKey}`}
              plan={plan}
              churchId="scroll-test-church"
              controllerProfileId="presentation"
              sectionLabelColor="#a855f7"
              sectionBorderColor="#06b6d4"
            />
          </FloatingWindow>
        </FloatingWindowZIndexProvider>
      </MemoryRouter>
    </Provider>
  );
};

declare global {
  interface Window {
    applyServicePlanRefresh?: () => void;
    removeServicePlanItem?: (itemId: string) => void;
  }
}

createRoot(document.getElementById("root")!).render(<App />);
