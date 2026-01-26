import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { CreditsInfo } from "../types";
import generateRandomId from "../utils/generateRandomId";

const dummyList = [
  {
    id: "1ii2lhhaa5vngn4rnt1",
    heading: "Executive Producers",
    text: "Church Name, Pastor Name, Program Coordinator Name",
  },
  {
    id: "1ii2lhv06d5ognttipk",
    heading: "Production Manager",
    text: "Mr. Producer",
  },
  {
    id: "1ii2lhvo5c3mojaufji",
    heading: "Sabbath School",
    text: "The Sabbath School Panel",
  },
  {
    id: "1ii2li219jp15caovrp",
    heading: "Welcome & Reminders",
    text: "Church Clerk",
  },
  {
    id: "1ii2li2s1i64l5olfgi8",
    heading: "Call to Praise",
    text: "Elder Praise",
  },
  {
    id: "1ii2li3qlnlndds9ajl",
    heading: "Invocation",
    text: "Elder Invocation",
  },
  {
    id: "1ii2li4uctgtogc3lcio",
    heading: "Reading of the Word",
    text: "The Reader",
  },
  {
    id: "1ii2lici6729nkna30p8",
    heading: "Intercessory Prayer",
    text: "Mrs. Prayer Ministry",
  },
  {
    id: "1ii2lidg08phl9fjceb",
    heading: "Offertory",
    text: "Treasurer",
  },
  {
    id: "1ii2n58rnrh9v66cum48",
    heading: "Special Song",
    text: "Special Singer",
  },
  {
    id: "1ii2n5a1gbqu22j0qnt8",
    heading: "Sermon ",
    text: "The Pastor",
  },
  {
    id: "1ii2n5atlus5qai05q5g",
    heading: "Technical Director",
    text: "Mr. Director",
  },
  {
    id: "1ii2qh5gqht3trsm7bcg",
    heading: "Production Coordinators",
    text: "The Coordinating Team",
  },
  {
    id: "1ii2qhp80jeuhl0m4mhg",
    heading: "Audio Engineers",
    text: "Front of House - Mr. Mixer\nOnline - Mrs. Studio",
  },
  {
    id: "1ii2qj7lbhi4ra1mdb88",
    heading: "Camera Operators",
    text: "The Camera Crew",
  },
  {
    id: "1ii2qk9514kti204lv9o",
    heading: "Graphics",
    text: "Graphics Team",
  },
  {
    id: "1ii2qktdrk4evhfs062o",
    heading: "Text Master",
    text: "The Master of Texts",
  },
  {
    id: "1ii2qlhskb1odmu6g47",
    heading: "Praise Team",
    text: "Lead - Mr. Singer\nSinger One \nSinger Two\n Singer Three",
  },
  {
    id: "1ii2qnbhgsf1oq3bqvn",
    heading: "Band",
    text: "Keys - Pianist\nGuitar - Guitarist\nBass - Mr. Bass\nDrums - The Drummer",
  },
  {
    id: "1ii2qq5m6cs30bcv8hfo",
    heading: "Church Name",
    text: "",
  },
  {
    id: "1ii2qqn9kgs70vr15n6",
    heading: "Church Mission",
    text: "",
  },
];

// const dummyList = [
//   {
//     id: "1ii2li15sk4lrvslqje8",
//     heading: "Supreme Provider",
//     text: "Jesus Christ",
//   },
//   {
//     id: "1ii2lhhaa5vngn4rnt1",
//     heading: "Executive Producers",
//     text: "Eliathah SDA\nGreg Baldeo\nOrville Mullings\nDonna Cheddar\nClifton Anderson",
//   },
//   {
//     id: "1ii2lhv06d5ognttipk",
//     heading: "Production Manager",
//     text: "Sharon Cox",
//   },
//   {
//     id: "1ii2lhvo5c3mojaufji",
//     heading: "Sabbath School",
//     text: "Candace Bailey\nOwn Mullings\nJenska Jeanty\nJenskya Jeanty",
//   },
//   {
//     id: "1ii2li219jp15caovrp",
//     heading: "Welcome & Reminders",
//     text: "Jennifer Peters",
//   },
//   {
//     id: "1ii2li2s1i64l5olfgi8",
//     heading: "Call to Praise",
//     text: "Bertie Hall",
//   },
//   {
//     id: "1ii2li3qlnlndds9ajl",
//     heading: "Invocation",
//     text: "Bertie Hall",
//   },
//   {
//     id: "1ii2li4uctgtogc3lcio",
//     heading: "Reading of the Word",
//     text: "Candace and Nicholas Bailey",
//   },
//   {
//     id: "1ii2lici6729nkna30p8",
//     heading: "Intercessory Prayer",
//     text: "Nelih Morgan",
//   },
//   {
//     id: "1ii2lidg08phl9fjceb",
//     heading: "Offertory",
//     text: "Gorphine Tomlinson",
//   },
//   {
//     id: "1ii2n58rnrh9v66cum48",
//     heading: "Special Song",
//     text: "Sherian & Co",
//   },
//   {
//     id: "1ii2n5a1gbqu22j0qnt8",
//     heading: "Sermon ",
//     text: "Dr. Greg Baldeo",
//   },
//   {
//     id: "1ii2n5atlus5qai05q5g",
//     heading: "Technical Director",
//     text: "Brandon Cheddar",
//   },
//   {
//     id: "1ii2qh5gqht3trsm7bcg",
//     heading: "Production Coordinators",
//     text: "Dawnette Baldeo, Ariel",
//   },
//   {
//     id: "1ii2qhp80jeuhl0m4mhg",
//     heading: "Audio Engineers",
//     text: "Front of House - Donte Anderson\nOnline - Venecia Cheddar",
//   },
//   {
//     id: "1ii2qj7lbhi4ra1mdb88",
//     heading: "Camera Operators",
//     text: "Kevin Cheddar\nDavid Edwards\nZachary Cheddar\nJayden\nChaise",
//   },
//   {
//     id: "1ii2qk9514kti204lv9o",
//     heading: "Graphics",
//     text: "Judith Gayle",
//   },
//   {
//     id: "1ii2qktdrk4evhfs062o",
//     heading: "Text Master",
//     text: "Enya Cheddar",
//   },
//   {
//     id: "1ii2qlhskb1odmu6g47",
//     heading: "Praise Team",
//     text: "Lead - Brianda Edwards\nStephen Mills\nGuerdy Guerrier\nKayori Williams",
//   },
//   {
//     id: "1ii2qnbhgsf1oq3bqvn",
//     heading: "Band",
//     text: "Keys - Wes Pierre\nGuitar - Moses Pierre\nBass - Jimmy Fevrier\nDrums - TJ Valentine",
//   },
//   {
//     id: "1ii2qq5m6cs30bcv8hfo",
//     heading: "Eliathah Seventh-day Adventist Church",
//     text: "",
//   },
//   {
//     id: "1ii2qqn9kgs70vr15n6",
//     heading: "United For Impactful Service and Mission",
//     text: "",
//   },
// ];

type CreditsState = {
  list: CreditsInfo[];
  publishedList: CreditsInfo[];
  initialList: string[];
  isLoading: boolean;
  transitionScene: string;
  creditsScene: string;
  scheduleName: string;
  selectedCreditId: string;
  isInitialized: boolean;
};

const initialState: CreditsState = {
  list: [],
  publishedList: [],
  initialList: [],
  isLoading: true,
  transitionScene: "",
  creditsScene: "",
  scheduleName: "",
  selectedCreditId: "",
  isInitialized: false,
};

export const creditsSlice = createSlice({
  name: "credits",
  initialState,
  reducers: {
    addCredit: (state) => {
      const newCredit = {
        heading: "",
        text: "",
        id: generateRandomId(),
      };
      const selectedIndex = state.list.findIndex(
        (credit) => credit.id === state.selectedCreditId
      );
      if (selectedIndex === -1) {
        state.list.push(newCredit);
      } else {
        state.list.splice(selectedIndex + 1, 0, newCredit);
      }
      state.selectedCreditId = newCredit.id;
    },
    selectCredit: (state, action: PayloadAction<string>) => {
      state.selectedCreditId = action.payload;
    },
    initiateTransitionScene: (state, action: PayloadAction<string>) => {
      state.transitionScene = action.payload;
    },
    setTransitionScene: (state, action: PayloadAction<string>) => {
      state.transitionScene = action.payload;
    },
    initiateCreditsScene: (state, action: PayloadAction<string>) => {
      state.creditsScene = action.payload;
    },
    setCreditsScene: (state, action: PayloadAction<string>) => {
      state.creditsScene = action.payload;
    },
    updateCreditsList: (state, action: PayloadAction<CreditsInfo[]>) => {
      state.list = action.payload;
    },
    updatePublishedCreditsList: (state) => {
      state.publishedList = state.list
        .filter((credit) => !credit.hidden)
        .map((credit) => credit);
    },
    initiateCreditsList: (state, action: PayloadAction<CreditsInfo[]>) => {
      if (action.payload.length === 0) {
        state.list = dummyList;
      } else {
        state.list = action.payload.map((credit) => ({
          ...credit,
          id: generateRandomId(),
        }));
      }
      state.initialList = state.list.map((credit) => credit.id);
      state.isInitialized = true;
    },
    initiatePublishedCreditsList: (
      state,
      action: PayloadAction<CreditsInfo[]>
    ) => {
      if (action.payload.length === 0) {
        state.publishedList = [];
        return;
      }
      state.publishedList = action.payload.map((credit) => ({
        ...credit,
        id: generateRandomId(),
      }));
    },
    updateCreditsListFromRemote: (
      state,
      action: PayloadAction<CreditsInfo[]>
    ) => {
      if (action.payload.length === 0) {
        state.list = [];
        return;
      }
      state.list = action.payload.map((credit) => ({
        ...credit,
        id: credit.id || generateRandomId(),
      }));
    },
    updatePublishedCreditsListFromRemote: (
      state,
      action: PayloadAction<CreditsInfo[]>
    ) => {
      if (action.payload.length === 0) {
        state.publishedList = [];
        return;
      }
      state.publishedList = action.payload.map((credit) => ({
        ...credit,
        id: credit.id || generateRandomId(),
      }));
    },
    deleteCredit: (state, action: PayloadAction<string>) => {
      state.list = state.list.filter((credit) => credit.id !== action.payload);
    },
    updateCredit: (state, action: PayloadAction<CreditsInfo>) => {
      state.list = state.list.map((credit) => {
        if (credit.id === action.payload.id) {
          return { ...action.payload };
        }
        return credit;
      });
    },
    updateInitialList: (state) => {
      state.initialList = state.list.map((credit) => credit.id);
    },
    setIsLoading: (state, action: PayloadAction<boolean>) => {
      state.isLoading = action.payload;
    },
    setScheduleName: (state, action: PayloadAction<string>) => {
      state.scheduleName = action.payload;
    },
    forceUpdate: () => {},
  },
});

export const {
  addCredit,
  selectCredit,
  initiateTransitionScene,
  setTransitionScene,
  initiateCreditsScene,
  setCreditsScene,
  updateCreditsList: updateList,
  updatePublishedCreditsList,
  deleteCredit,
  updateCredit,
  initiateCreditsList,
  initiatePublishedCreditsList,
  updateCreditsListFromRemote,
  updatePublishedCreditsListFromRemote,
  updateInitialList,
  setIsLoading,
  setScheduleName,
  forceUpdate,
} = creditsSlice.actions;

export default creditsSlice.reducer;
