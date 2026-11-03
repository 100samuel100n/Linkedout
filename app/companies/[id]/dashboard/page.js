"use client";
import { Suspense, use } from "react";
import Loading from "@/components/ui/Loading";
import Dashboard from "@/components/company-suite/Dashboard";

export default function Page({ params }) {
  const { id } = use(params);
  return <Suspense fallback={<Loading variant="cards" />}><Dashboard id={id} /></Suspense>;
}
