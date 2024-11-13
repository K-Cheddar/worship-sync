import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { OverlayType } from "../types";
import generateRandomId from "../utils/generateRandomId";

const dummyOverlays: OverlayType[] = [
  {
    title: "",
    id: generateRandomId(),
    name: "email address: pastor@eliathahsda.org",
    showDelete: false,
    event: "phone #: 203-231-9960",
    duration: 7,
    type: "floating",
  },
  {
    title: "",
    id: generateRandomId(),
    name: "Rashaun Baldeo",
    showDelete: false,
    event: "Sabbath School Host",
    duration: 7,
    type: "floating",
  },
  {
    title: "",
    id: generateRandomId(),
    name: "Jacob Hall",
    showDelete: false,
    event: "Sabbath School Co-Host",
    duration: 7,
    type: "floating",
  },
  {
    title: "",
    id: generateRandomId(),
    name: "Yolanda Hall",
    showDelete: false,
    event: "Sabbath School Co-Host",
    duration: 7,
    type: "floating",
  },
  {
    title: "",
    id: generateRandomId(),
    name: "Javar Baldeo",
    showDelete: false,
    event: "Sabbath School Co-Host",
    duration: 7,
    type: "floating",
  },
  {
    title: "",
    id: generateRandomId(),
    name: "Dr. Greg Baldeo Orville Mullings & Jennifer Peters",
    showDelete: false,
    event: "Welcome ",
    duration: 7,
    type: "floating",
  },
  {
    title: "",
    id: generateRandomId(),
    name: "Praise Team",
    showDelete: false,
    event: "Welcome & Welcome Song",
    duration: 7,
    type: "floating",
  },
  {
    title: "",
    id: generateRandomId(),
    name: "Dr. Greg Baldeo, Orville Mullings & Jennifer Peters",
    showDelete: true,
    event: "Announcements",
    duration: 7,
    type: "floating",
  },
  {
    title: "",
    id: generateRandomId(),
    name: "Clifton Anderson",
    showDelete: false,
    event: "Call to Praise",
    duration: 7,
    type: "floating",
  },
  {
    title: "",
    id: generateRandomId(),
    name: "Praise Team",
    showDelete: false,
    event: "Song of Praise",
    duration: 7,
    type: "floating",
  },
  {
    title: "",
    id: generateRandomId(),
    name: "Clifton Anderson",
    showDelete: false,
    event: "Invocation",
    duration: 7,
    type: "floating",
  },
  {
    title: "",
    id: generateRandomId(),
    name: "Praise Team ",
    showDelete: false,
    event: "Congregational Hymn",
    duration: 7,
    type: "floating",
  },
  {
    title: "",
    id: generateRandomId(),
    name: "Alyandra ",
    showDelete: false,
    event: "Reading the Word",
    duration: 7,
    type: "floating",
  },
  {
    title: "",
    id: generateRandomId(),
    name: "Dobney Keen",
    showDelete: false,
    event: "Offertory",
    duration: 7,
    type: "floating",
  },
  {
    title: "",
    id: generateRandomId(),
    name: "Patrick Robinson",
    showDelete: false,
    event: "Special Song",
    duration: 7,
    type: "floating",
  },
  {
    title: "",
    id: generateRandomId(),
    name: "Worship Leader",
    showDelete: false,
    event: "Call to Prayer",
    duration: 7,
    type: "floating",
  },
  {
    title: "",
    id: generateRandomId(),
    name: "Praise Team",
    showDelete: false,
    event: "Prayer Song",
    duration: 7,
    type: "floating",
  },
  {
    title: "",
    id: generateRandomId(),
    name: "Luciana Esnard",
    showDelete: false,
    event: "Intercessory Prayer",
    duration: 7,
    type: "floating",
  },
  {
    title: "",
    id: generateRandomId(),
    name: "Praise Team ",
    showDelete: false,
    event: "Praise & Worship",
    duration: 7,
    type: "floating",
  },
  {
    title: "",
    id: generateRandomId(),
    name: "Orville Mullings",
    showDelete: false,
    event: 'Sermon - "What is Next"',
    duration: 7,
    type: "floating",
  },
  {
    title: "",
    id: generateRandomId(),
    name: "Praise Team",
    showDelete: false,
    event: "Appeal Song",
    duration: 7,
    type: "floating",
  },
  {
    title: "",
    id: generateRandomId(),
    name: "Orville Mullings",
    showDelete: false,
    event: "Appeal / Closing Prayer",
    duration: 7,
    type: "floating",
  },
  {
    title: "",
    id: generateRandomId(),
    name: "Praise Team",
    showDelete: false,
    event: "Afterglow",
    duration: 7,
    type: "floating",
  },
];

type OverlaysState = OverlayType & {
  list: OverlayType[];
};

const initialState: OverlaysState = {
  name: "",
  title: "",
  event: "",
  id: "",
  duration: 7,
  type: "floating",
  showDelete: true,
  list: [],
};

export const overlaysSlice = createSlice({
  name: "overlays",
  initialState,
  reducers: {
    selectOverlay: (state, action: PayloadAction<OverlayType>) => {
      state.name = action.payload.name;
      state.title =
        action.payload.type === "stick-to-bottom" ? "" : action.payload.title;
      state.event = action.payload.event;
      state.id = action.payload.id;
      state.duration = action.payload.duration;
      state.type = action.payload.type;
      state.showDelete = action.payload.showDelete;
    },
    addOverlay: (state) => {
      state.list.push({
        name: "",
        title: "",
        event: "",
        duration: 7,
        type: "floating",
        showDelete: true,
        id: generateRandomId(),
      });
    },
    updateOverlayList: (state, action: PayloadAction<OverlayType[]>) => {
      state.list = action.payload;
    },
    initiateOverlayList: (state, action: PayloadAction<OverlayType[]>) => {
      if (action.payload.length === 0) {
        state.list = dummyOverlays;
        return;
      }
      state.list = action.payload.map((overlay) => ({
        ...overlay,
        id: generateRandomId(),
      }));
    },
    deleteOverlay: (state, action: PayloadAction<string>) => {
      state.list = state.list.filter(
        (overlay) => overlay.id !== action.payload
      );
    },
    updateOverlay: (state, action: PayloadAction<OverlayType>) => {
      state.list = state.list.map((overlay) => {
        if (overlay.id === action.payload.id) {
          return {
            ...action.payload,
            title:
              action.payload.type === "stick-to-bottom"
                ? ""
                : action.payload.title,
          };
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
} = overlaysSlice.actions;

export default overlaysSlice.reducer;
