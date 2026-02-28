import "./constellations-global.css";

export const metadata = {
  title: "Constellation Research Graph",
};

export default function ConstellationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="constellations-root">{children}</div>;
}
