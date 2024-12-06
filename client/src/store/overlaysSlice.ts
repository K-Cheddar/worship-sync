import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { OverlayInfo } from "../types";
import generateRandomId from "../utils/generateRandomId";

const dummyOverlays: OverlayInfo[] = [
  {
    id: "1ie7ha1ps489fli2fm7",
    name: "email address: pastor@church.org",
    title: "",
    event: "phone #: 123-456-7890",
    heading: "pastor@church.org",
    subHeading: "123-456-7890",
    url: "",
    description: "",
    color: "Green",
    duration: 7,
    type: "stick-to-bottom",
  },
  {
    id: "1ie7ha1pska4kie10au8",
    name: "",
    title: "",
    event: "",
    heading: "",
    subHeading: "",
    url: "www.worshipsync.net",
    description: "Share a special link for your audience to scan here!",
    color: "#2563eb",
    duration: 30,
    type: "qr-code",
  },
  {
    id: "1ie7ha1pst26cpk1efq",
    name: "Host Name",
    title: "",
    event: "Sabbath School Host",
    duration: 7,
    type: "participant",
  },
  {
    id: "1ie7ha1psml3hjvk5e98",
    name: "Co-Host 1 Name",
    title: "",
    event: "Sabbath School Co-Host",
    duration: 7,
    type: "participant",
  },
  {
    id: "1ie7ha1psohr2ecrrn6g",
    name: "Co-Host 2 Name",
    title: "",
    event: "Sabbath School Co-Host",
    duration: 7,
    type: "participant",
  },
  {
    id: "1ie7ha1ps86tfso8nu",
    name: "Announcer Name!",
    title: "",
    event: "Announcements",
    duration: 7,
    type: "participant",
  },
  {
    id: "1ie7ha1psa0dkjatfkg8",
    name: "Greeter Name",
    title: "",
    event: "Welcome ",
    duration: 7,
    type: "participant",
  },
  {
    id: "1ie7ha1psol07vae3g5",
    name: "Praise Team",
    title: "",
    event: "Welcome Song",
    duration: 7,
    type: "participant",
  },
  {
    id: "1ie7ha1pskjkscor5eno",
    name: "Reader Name",
    title: "",
    event: "Reading the Word",
    duration: 7,
    type: "participant",
  },
  {
    id: "1ie7ha1psb89cctrmjq",
    name: "Treasurer Name",
    title: "",
    event: "Offertory",
    duration: 7,
    type: "participant",
  },
  {
    id: "1ie7ha1ps3ng0rhhmslo",
    name: "Singer Name",
    title: "",
    event: "Special Song",
    duration: 7,
    type: "participant",
  },
  {
    id: "1ie7ha1psl4i0fnddrsg",
    name: "Prayer Name",
    title: "",
    event: "Intercessory Prayer",
    duration: 7,
    type: "participant",
  },
  {
    id: "1ie7ha1ps19f1iv9ki98",
    name: "Praise Team ",
    title: "",
    event: "Praise & Worship",
    duration: 7,
    type: "participant",
  },
  {
    id: "1ie7ha1ps001aqhnhoio",
    name: "Pastor Name",
    title: "",
    event: 'Sermon - "Sermon Title"',
    duration: 7,
    type: "participant",
  },
  {
    id: "1ie7ha1psbjcclb88uto",
    name: "Praise Team",
    title: "",
    event: "Appeal Song",
    duration: 7,
    type: "participant",
  },
  {
    id: "1ie7ha1psucgaqnvlp68",
    name: "Praise Team",
    title: "",
    event: "Afterglow",
    duration: 7,
    type: "participant",
  },
  {
    id: "1ie7ha1psjnqrcp0r1ig",
    name: "Pastor Name",
    title: "",
    event: "Appeal / Closing Prayer",
    duration: 7,
    type: "participant",
  },
];

type OverlaysState = OverlayInfo & {
  list: OverlayInfo[];
};

const initialState: OverlaysState = {
  name: "",
  title: "",
  event: "",
  heading: "",
  subHeading: "",
  url: "",
  description: "",
  color: "#16a34a",
  id: "",
  duration: 7,
  type: "participant",
  list: [],
};

export const overlaysSlice = createSlice({
  name: "overlays",
  initialState,
  reducers: {
    selectOverlay: (state, action: PayloadAction<OverlayInfo>) => {
      state.name = action.payload.name;
      state.title = action.payload.title;
      state.event = action.payload.event;
      state.heading = action.payload.heading;
      state.subHeading = action.payload.subHeading;
      state.url = action.payload.url;
      state.description = action.payload.description;
      state.color = action.payload.color;
      state.id = action.payload.id;
      state.duration = action.payload.duration;
      state.type = action.payload.type;
    },
    addOverlay: (state) => {
      const existingIndex = state.list.findIndex(
        (overlay) => overlay.id === state.id
      );
      const { list, ...itemState } = state;
      const newItem = {
        ...itemState,
        name:
          itemState.type === "participant"
            ? itemState.name + " (Copy)"
            : itemState.name,
        heading:
          itemState.type === "stick-to-bottom"
            ? itemState.heading + " (Copy)"
            : itemState.heading,
        description:
          itemState.type === "qr-code"
            ? itemState.description + " (Copy)"
            : itemState.description,
        id: generateRandomId(),
      };
      if (existingIndex !== -1) {
        state.list.splice(existingIndex + 1, 0, newItem);
      } else {
        state.list.push(newItem);
      }
    },
    updateOverlayList: (state, action: PayloadAction<OverlayInfo[]>) => {
      state.list = action.payload;
    },
    initiateOverlayList: (state, action: PayloadAction<OverlayInfo[]>) => {
      if (action.payload.length === 0) {
        state.list = dummyOverlays;
        return;
      }
      state.list = action.payload.map((overlay) => ({
        ...overlay,
        id: generateRandomId(),
      }));
    },
    updateOverlayListFromRemote: (
      state,
      action: PayloadAction<OverlayInfo[]>
    ) => {
      if (action.payload.length === 0) {
        state.list = dummyOverlays;
        return;
      }
      state.list = action.payload.map((overlay) => ({
        ...overlay,
        id: overlay.id || generateRandomId(),
      }));
    },
    deleteOverlay: (state, action: PayloadAction<string>) => {
      state.list = state.list.filter(
        (overlay) => overlay.id !== action.payload
      );
      if (state.id === action.payload) {
        state.id = "";
        state.color = "#16a34a";
        state.name = "";
        state.title = "";
        state.event = "";
        state.heading = "";
        state.subHeading = "";
        state.url = "";
        state.description = "";
        state.duration = 7;
        state.type = "participant";
      }
    },
    updateOverlay: (state, action: PayloadAction<OverlayInfo>) => {
      state.list = state.list.map((overlay) => {
        if (overlay.id === action.payload.id) {
          return { ...action.payload };
        }
        return overlay;
      });
    },
  },
});

export const {
  selectOverlay,
  addOverlay,
  updateOverlayList: updateList,
  deleteOverlay,
  updateOverlay,
  initiateOverlayList,
  updateOverlayListFromRemote,
} = overlaysSlice.actions;

export default overlaysSlice.reducer;
