import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecentChatsDrawer } from "./RecentChatsDrawer";
import type { OngoingSessionChat } from "./RecentChatsDrawer";

afterEach(() => {
  vi.unstubAllGlobals();
});

const mockSavedChats = [
  {
    id: "saved-1",
    title: "Saved Policy Chat",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    message_count: 4,
  },
];

const mockOngoingChats: OngoingSessionChat[] = [
  {
    id: "ongoing-1",
    title: "How many days of annual leave do I get?",
    message_count: 2,
    updated_at: new Date().toISOString(),
  },
];

describe("RecentChatsDrawer ongoing chat behavior", () => {
  it("renders ongoing chat with title in sidebar without needing to save it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify(mockSavedChats), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const onSelectOngoing = vi.fn();
    const onSaveOngoing = vi.fn();
    const onDeleteOngoing = vi.fn();

    render(
      <RecentChatsDrawer
        isOpen
        variant="sidebar"
        onClose={() => {}}
        onSelectChat={() => {}}
        ongoingChats={mockOngoingChats}
        activeOngoingId="ongoing-1"
        onSelectOngoingChat={onSelectOngoing}
        onSaveOngoingChat={onSaveOngoing}
        onDeleteOngoingChat={onDeleteOngoing}
      />,
    );

    // Section header and ongoing chat title
    expect(screen.getByText("Ongoing")).toBeInTheDocument();
    const titleBtn = screen.getByText("How many days of annual leave do I get?");
    expect(titleBtn).toBeInTheDocument();
    expect(titleBtn).toHaveAttribute("aria-current", "page");

    // Click on ongoing chat opens/selects it
    fireEvent.click(titleBtn);
    expect(onSelectOngoing).toHaveBeenCalledWith("ongoing-1");

    // Save button triggers save only when pressed
    const saveBtn = screen.getByLabelText("Save How many days of annual leave do I get?");
    expect(saveBtn).toBeInTheDocument();
    fireEvent.click(saveBtn);
    expect(onSaveOngoing).toHaveBeenCalledWith("ongoing-1");

    // Discard button triggers discard
    const deleteBtn = screen.getByLabelText("Discard How many days of annual leave do I get?");
    expect(deleteBtn).toBeInTheDocument();
    fireEvent.click(deleteBtn);
    expect(onDeleteOngoing).toHaveBeenCalledWith("ongoing-1");
  });

  it("keeps ongoing chat visible even when chat history is refreshed", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(mockSavedChats), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <RecentChatsDrawer
        isOpen
        variant="sidebar"
        onClose={() => {}}
        onSelectChat={() => {}}
        ongoingChats={mockOngoingChats}
        activeOngoingId="ongoing-1"
      />,
    );

    expect(screen.getByText("How many days of annual leave do I get?")).toBeInTheDocument();

    // Click the refresh button next to Chat History
    const refreshBtn = screen.getByLabelText("Refresh chat history");
    fireEvent.click(refreshBtn);

    // Ongoing chat STILL exists in the sidebar
    expect(screen.getByText("How many days of annual leave do I get?")).toBeInTheDocument();
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
  });
});
