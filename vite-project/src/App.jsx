import ParallaxCanvas from "./parallax/ParallaxCanvas";

export default function App() {
  return (
    <div style={{ height: "100vh", padding: 12, background: "#0b1020" }}>
      <ParallaxCanvas
        style={{ height: "100%", border: "1px solid rgba(255,255,255,0.12)" }}
        strength={40}
        smoothing={0.12}
        invert={true}
      />
    </div>
  );
}
