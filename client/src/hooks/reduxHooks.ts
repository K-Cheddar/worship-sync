import {
  useDispatch as _useDispatch,
  useSelector as _useSelector,
} from "react-redux";
import { createAsyncThunk as _createAsyncThunk } from "@reduxjs/toolkit";
import type { RootState, AppDispatch } from "../store/store";

export const useDispatch = _useDispatch.withTypes<AppDispatch>();
export const useSelector = _useSelector.withTypes<RootState>();
export const createAsyncThunk = _createAsyncThunk.withTypes<{
  state: RootState;
  dispatch: AppDispatch;
}>();
