import { useRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useHistoryState, useLoadedCount, useScrollMemory } from "./use-history-state.ts";

let navigate: ReturnType<typeof useNavigate>;
function Nav() {
  navigate = useNavigate();
  return null;
}

function List() {
  const [search, setSearch] = useHistoryState("search", "");
  const [first, remember] = useLoadedCount("items", 24);
  return (
    <div>
      <input aria-label="search" value={search} onChange={(e) => setSearch(e.target.value)} />
      <span data-testid="first">{first}</span>
      <button onClick={() => remember(72)}>loaded 72</button>
    </div>
  );
}

// A scrolling <main> like the dashboard's, with its height faked (jsdom has no layout).
function Layout({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  useScrollMemory(ref);
  return (
    <main ref={ref} data-testid="main">
      {children}
    </main>
  );
}

function App() {
  return (
    <MemoryRouter initialEntries={["/list"]}>
      <Nav />
      <Layout>
        <Routes>
          <Route path="/list" element={<List />} />
          <Route path="/item" element={<p>item</p>} />
        </Routes>
      </Layout>
    </MemoryRouter>
  );
}

function fakeHeight(el: HTMLElement, height: number) {
  Object.defineProperty(el, "scrollHeight", { configurable: true, get: () => height });
  Object.defineProperty(el, "clientHeight", { configurable: true, get: () => 800 });
}

beforeEach(() => {
  sessionStorage.clear();
  vi.useFakeTimers({ toFake: ["requestAnimationFrame", "cancelAnimationFrame", "Date"] });
});
afterEach(() => vi.useRealTimers());

describe("Back to a list", () => {
  it("brings back the list's state and how many were loaded, and a fresh visit starts clean", () => {
    render(<App />);
    fireEvent.change(screen.getByLabelText("search"), { target: { value: "dog bed" } });
    fireEvent.click(screen.getByText("loaded 72"));
    act(() => navigate("/item"));
    act(() => navigate(-1));
    expect(screen.getByLabelText("search")).toHaveValue("dog bed");
    expect(screen.getByTestId("first")).toHaveTextContent("72");
    // Opening the list anew (not Back) is a new history entry: nothing carried over.
    act(() => navigate("/item"));
    act(() => navigate("/list"));
    expect(screen.getByLabelText("search")).toHaveValue("");
    expect(screen.getByTestId("first")).toHaveTextContent("24");
  });

  it("puts the scroll back once the list is tall enough, and starts a new page at the top", () => {
    render(<App />);
    const main = screen.getByTestId("main");
    fakeHeight(main, 5000);
    main.scrollTop = 2400;
    fireEvent.scroll(main);
    act(() => vi.advanceTimersToNextFrame());

    act(() => navigate("/item"));
    expect(main.scrollTop).toBe(0);

    // Back: the list hasn't loaded its items yet, so wait for them before scrolling.
    fakeHeight(main, 900);
    act(() => navigate(-1));
    expect(main.scrollTop).toBe(0);
    fakeHeight(main, 5000);
    act(() => vi.advanceTimersToNextFrame());
    expect(main.scrollTop).toBe(2400);
  });

  it("stops waiting when the user scrolls on their own", () => {
    render(<App />);
    const main = screen.getByTestId("main");
    fakeHeight(main, 5000);
    main.scrollTop = 2400;
    fireEvent.scroll(main);
    act(() => vi.advanceTimersToNextFrame());
    act(() => navigate("/item"));

    fakeHeight(main, 900);
    act(() => navigate(-1));
    fireEvent.wheel(main);
    main.scrollTop = 50;
    fakeHeight(main, 5000);
    act(() => vi.advanceTimersToNextFrame());
    expect(main.scrollTop).toBe(50);
  });
});
