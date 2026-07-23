import { AnalyzerView } from "./AnalyzerView";

export const metadata = {
  title: "Analyzer – MGflasher Log Analyzer",
};

// Client-driven workspace: parsing, charting and history all live in the
// browser (logs never leave the device on upload). The layout already gates
// access via requireAppAccess("log-analyzer").
export default function LogAnalyzerPage() {
  return <AnalyzerView />;
}
