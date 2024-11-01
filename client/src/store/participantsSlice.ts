import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { ParticipantType } from '../types';
import generateRandomId from '../utils/generateRandomId';

const dummyParticipants: ParticipantType[] = [
  {
    title: '', 
    id: generateRandomId(), 
    name: "email address: pastor@eliathahsda.org",
    showDelete: false,
    event: "phone #: 203-231-9960",
  },
  {
    title: '', 
    id: generateRandomId(), 
    name: "Rashaun Baldeo",
    showDelete: false,
    event: "Sabbath School Host",
  },
  {
    title: '', 
    id: generateRandomId(), 
    name: "Jacob Hall",
    showDelete: false,
    event: "Sabbath School Co-Host",
  },
  {
    title: '', 
    id: generateRandomId(), 
    name: "Yolanda Hall",
    showDelete: false,
    event: "Sabbath School Co-Host",
  },
  {
    title: '', 
    id: generateRandomId(), 
    name: "Javar Baldeo",
    showDelete: false,
    event: "Sabbath School Co-Host",
  },
  {
    title: '', 
    id: generateRandomId(), 
    name: "Dr. Greg Baldeo Orville Mullings & Jennifer Peters",
    showDelete: false,
    event: "Welcome ",
  },
  {
    title: '', 
    id: generateRandomId(), 
    name: "Praise Team",
    showDelete: false,
    event: "Welcome & Welcome Song",
  },
  {
    title: '', 
    id: generateRandomId(), 
    name: "Dr. Greg Baldeo, Orville Mullings & Jennifer Peters",
    showDelete: true,
    event: "Announcements",
  },
  {
    title: '', 
    id: generateRandomId(), 
    name: "Clifton Anderson",
    showDelete: false,
    event: "Call to Praise",
  },
  {
    title: '', 
    id: generateRandomId(), 
    name: "Praise Team",
    showDelete: false,
    event: "Song of Praise",
  },
  {
    title: '', 
    id: generateRandomId(), 
    name: "Clifton Anderson",
    showDelete: false,
    event: "Invocation",
  },
  {
    title: '', 
    id: generateRandomId(), 
    name: "Praise Team ",
    showDelete: false,
    event: "Congregational Hymn",
  },
  {
    title: '', 
    id: generateRandomId(), 
    name: "Alyandra ",
    showDelete: false,
    event: "Reading the Word",
  },
  {
    title: '', 
    id: generateRandomId(), 
    name: "Dobney Keen",
    showDelete: false,
    event: "Offertory",
  },
  {
    title: '', 
    id: generateRandomId(), 
    name: "Patrick Robinson",
    showDelete: false,
    event: "Special Song",
  },
  {
    title: '', 
    id: generateRandomId(), 
    name: "Worship Leader",
    showDelete: false,
    event: "Call to Prayer",
  },
  {
    title: '', 
    id: generateRandomId(), 
    name: "Praise Team",
    showDelete: false,
    event: "Prayer Song",
  },
  {
    title: '', 
    id: generateRandomId(), 
    name: "Luciana Esnard",
    showDelete: false,
    event: "Intercessory Prayer",
  },
  {
    title: '', 
    id: generateRandomId(), 
    name: "Praise Team ",
    showDelete: false,
    event: "Praise & Worship",
  },
  {
    title: '', 
    id: generateRandomId(), 
    name: "Orville Mullings",
    showDelete: false,
    event: "Sermon - \"What is Next\"",
  },
  {
    title: '', 
    id: generateRandomId(), 
    name: "Praise Team",
    showDelete: false,
    event: "Appeal Song",
  },
  {
    title: '', 
    id: generateRandomId(), 
    name: "Orville Mullings",
    showDelete: false,
    event: "Appeal / Closing Prayer",
  },
  {
    title: '', 
    id: generateRandomId(), 
    name: "Praise Team",
    showDelete: false,
    event: "Afterglow",
  }
]

type ParticipantsState = ParticipantType & {
  list: ParticipantType[]
}

const initialState: ParticipantsState = {
  name: '',
  title: '',
  event: '',
  id: '',
  showDelete: true,
  list: dummyParticipants
}

export const participantsSlice = createSlice({
  name: 'participants',
  initialState,
  reducers: {
    selectParticipant: (state, action : PayloadAction<ParticipantType>) => {
      state.name = action.payload.name;
      state.title = action.payload.title;
      state.event = action.payload.event;
      state.id = action.payload.id;
      state.showDelete = action.payload.showDelete;
    },
    addParticipant: (state) => {
      state.list.push({
        name: '',
        title: '',
        event: '',
        showDelete: true,
        id: generateRandomId()
      })
    },
    updateList: (state, action : PayloadAction<ParticipantType[]>) => {
      state.list = action.payload;
    },
    deleteParticipant: (state, action : PayloadAction<string>) => {
      state.list = state.list.filter(participant => participant.id !== action.payload);
    },
    updateParticipant: (state, action : PayloadAction<ParticipantType>) => {
      const { name, title, event, id, showDelete } = action.payload;
      state.list = state.list.map(participant => {
        if (participant.id === id) {
          return {
            name,
            title,
            event,
            id,
            showDelete
          };
        }
        return participant;
      });
    }
  }
});

export const { 
  selectParticipant, 
  addParticipant, 
  updateList,
  deleteParticipant,
  updateParticipant
 } = participantsSlice.actions;

export default participantsSlice.reducer;