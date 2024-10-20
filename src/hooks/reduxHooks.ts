import { useDispatch as _useDispatch, useSelector as _useSelector } from 'react-redux'
import type { RootState, AppDispatch } from '../store/store'

// Use throughout your app instead of plain `useDispatch` and `useSelector`
export const useDispatch = _useDispatch.withTypes<AppDispatch>()
export const useSelector = _useSelector.withTypes<RootState>()