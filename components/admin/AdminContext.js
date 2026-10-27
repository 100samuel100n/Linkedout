"use client";
import { createContext, useContext } from "react";
export const AdminCtx = createContext(null);
export const useAdmin = () => useContext(AdminCtx);
