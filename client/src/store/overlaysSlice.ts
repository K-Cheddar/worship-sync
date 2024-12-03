import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { OverlayInfo } from "../types";
import generateRandomId from "../utils/generateRandomId";

const dummyOverlays: OverlayInfo[] = [
  {
    id: "1ido13oa37rcorfa09t",
    name: "email address: pastor@church.org",
    title: "",
    event: "phone #: 123-456-7890",
    showDelete: false,
    duration: 7,
    type: "stick-to-bottom",
  },
  {
    id: "1ido13oa3rk4br4a4qh",
    name: "Host Name",
    title: "",
    event: "Sabbath School Host",
    showDelete: false,
    duration: 7,
    type: "participant",
  },
  {
    id: "1ido13oa3fivqefmtpm8",
    name: "Co-Host 1 Name",
    title: "",
    event: "Sabbath School Co-Host",
    showDelete: false,
    duration: 7,
    type: "participant",
  },
  {
    id: "1ido13oa3u2ieh8h78m8",
    name: "Co-Host 2 Name",
    title: "",
    event: "Sabbath School Co-Host",
    showDelete: false,
    duration: 7,
    type: "participant",
  },
  {
    id: "1ido13oa3f1svnq65si",
    name: "Announcer Name!",
    title: "",
    event: "Announcements",
    showDelete: false,
    duration: 7,
    type: "participant",
  },
  {
    id: "1ido13oa3kv0vcnhp8b",
    name: "Greeter Name",
    title: "",
    event: "Welcome ",
    showDelete: false,
    duration: 7,
    type: "participant",
  },
  {
    id: "1ido13oa3di21upjov9",
    name: "Praise Team",
    title: "",
    event: "Welcome Song",
    showDelete: false,
    duration: 7,
    type: "participant",
  },
  {
    id: "1ido13oa3d6tj6hftfu",
    name: "Reader Name",
    title: "",
    event: "Reading the Word",
    showDelete: false,
    duration: 7,
    type: "participant",
  },
  {
    id: "1ido13oa3rl9e7c6rj8g",
    name: "Treasurer Name",
    title: "",
    event: "Offertory",
    showDelete: false,
    duration: 7,
    type: "participant",
  },
  {
    id: "1ido13oa3dcgkjfshgo8",
    name: "Singer Name",
    title: "",
    event: "Special Song",
    showDelete: false,
    duration: 7,
    type: "participant",
  },
  {
    id: "1ido13oa3cvatv91i9a",
    name: "Prayer Name",
    title: "",
    event: "Intercessory Prayer",
    showDelete: false,
    duration: 7,
    type: "participant",
  },
  {
    id: "1ido13oa38ps3qv5k4hg",
    name: "Praise Team ",
    title: "",
    event: "Praise & Worship",
    showDelete: false,
    duration: 7,
    type: "participant",
  },
  {
    id: "1ido13oa3ng1gaeqttp",
    name: "Pastor Name",
    title: "",
    event: 'Sermon - "Sermon Title"',
    showDelete: false,
    duration: 7,
    type: "participant",
  },
  {
    id: "1ido13oa343f1bdaak7",
    name: "Praise Team",
    title: "",
    event: "Appeal Song",
    showDelete: false,
    duration: 7,
    type: "participant",
  },
  {
    id: "1ido13oa381jg3ebknqg",
    name: "Praise Team",
    title: "",
    event: "Afterglow",
    showDelete: false,
    duration: 7,
    type: "participant",
  },
  {
    id: "1ido13oa3ikr5nqouvt8",
    name: "Pastor Name",
    title: "",
    event: "Appeal / Closing Prayer",
    showDelete: false,
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
  color: "Green",
  id: "",
  duration: 7,
  type: "participant",
  showDelete: true,
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
      state.showDelete = action.payload.showDelete;
    },
    addOverlay: (state) => {
      state.list.push({
        ...initialState,
        id: generateRandomId(),
      });
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
    deleteOverlay: (state, action: PayloadAction<string>) => {
      state.list = state.list.filter(
        (overlay) => overlay.id !== action.payload
      );
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
} = overlaysSlice.actions;

export default overlaysSlice.reducer;
