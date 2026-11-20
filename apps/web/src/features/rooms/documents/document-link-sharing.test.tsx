import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import {
  TeamHubError,
  type TeamHubClient,
} from "@/features/teamhub/teamhub-client";
import type { DocumentLinkPolicy } from "@/features/teamhub/teamhub-document-links";
import { DocumentLinkSharing } from "./document-link-sharing";

it("creates a read link, changes its role, and revokes the current version", async () => {
  let policy: DocumentLinkPolicy | null = null;
  const get = vi.fn(async () => policy);
  const set = vi.fn(async (_id, input) => {
    policy = {
      id: "link-1",
      document_id: "doc-1",
      role: input.role,
      status: "active",
      version: input.expected_version + 1,
    };
    return {
      ...policy,
      ...(input.expected_version === 0
        ? { url: "https://web.test/shared-documents#test" }
        : {}),
    };
  });
  const revoke = vi.fn(async () => {
    policy = { ...policy!, status: "revoked", version: policy!.version + 1 };
  });
  const client = {
    documentLinks: { get, set, revoke },
  } as unknown as TeamHubClient;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DocumentLinkSharing client={client} documentId="doc-1" />
    </QueryClientProvider>,
  );
  const control = screen.getByRole("combobox", { name: "Link access" });
  await waitFor(() => expect(control).toBeEnabled());
  fireEvent.click(control);
  fireEvent.click(await screen.findByRole("option", { name: "Can view" }));
  expect(
    await screen.findByRole("button", { name: "Copy shared link" }),
  ).toBeEnabled();
  expect(set).toHaveBeenLastCalledWith("doc-1", {
    role: "viewer",
    expected_version: 0,
    reset: false,
  });
  fireEvent.click(control);
  fireEvent.click(await screen.findByRole("option", { name: "Can edit" }));
  await waitFor(() => expect(control).toHaveValue("editor"));
  expect(set).toHaveBeenLastCalledWith("doc-1", {
    role: "editor",
    expected_version: 1,
    reset: false,
  });
  fireEvent.click(control);
  fireEvent.click(await screen.findByRole("option", { name: "Disabled" }));
  await waitFor(() => expect(control).toHaveValue("disabled"));
  expect(revoke).toHaveBeenCalledWith("doc-1", { expected_version: 2 });
  expect(screen.queryByRole("button", { name: "Copy shared link" })).toBeNull();
});

it("skips initial GET /link-share when the document has no active link share", async () => {
  let policy: DocumentLinkPolicy | null = null;
  const get = vi.fn(async () => policy);
  const set = vi.fn(async (_id, input) => {
    policy = {
      id: "link-2",
      document_id: "doc-2",
      role: input.role,
      status: "active",
      version: input.expected_version + 1,
    };
    return { ...policy, url: "https://web.test/shared-documents#new" };
  });
  const onPolicyChange = vi.fn();
  const client = {
    documentLinks: { get, set, revoke: vi.fn() },
  } as unknown as TeamHubClient;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DocumentLinkSharing
        client={client}
        documentId="doc-2"
        hasActiveLink={false}
        onPolicyChange={onPolicyChange}
      />
    </QueryClientProvider>,
  );
  const control = screen.getByRole("combobox", { name: "Link access" });
  expect(control).toBeEnabled();
  expect(control).toHaveValue("disabled");
  expect(get).not.toHaveBeenCalled();

  fireEvent.click(control);
  fireEvent.click(await screen.findByRole("option", { name: "Can view" }));
  expect(
    await screen.findByRole("button", { name: "Copy shared link" }),
  ).toBeEnabled();
  expect(set).toHaveBeenCalledWith("doc-2", {
    role: "viewer",
    expected_version: 0,
    reset: false,
  });
  expect(onPolicyChange).toHaveBeenCalledOnce();
});

it("recovers a previously revoked link version on 409 without an initial GET", async () => {
  let policy: DocumentLinkPolicy = {
    id: "link-3",
    document_id: "doc-3",
    role: "viewer",
    status: "revoked",
    version: 2,
  };
  const get = vi.fn(async () => policy);
  const set = vi.fn(async (_id, input) => {
    if (input.expected_version !== policy.version) {
      throw new TeamHubError({
        code: "CONFLICT",
        message: "Link version mismatch",
        status: 409,
      });
    }
    policy = {
      ...policy,
      role: input.role,
      status: "active",
      version: policy.version + 1,
    };
    return { ...policy, url: "https://web.test/shared-documents#revived" };
  });
  const client = {
    documentLinks: { get, set, revoke: vi.fn() },
  } as unknown as TeamHubClient;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <DocumentLinkSharing
        client={client}
        documentId="doc-3"
        hasActiveLink={false}
      />
    </QueryClientProvider>,
  );

  expect(get).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("combobox", { name: "Link access" }));
  fireEvent.click(await screen.findByRole("option", { name: "Can edit" }));

  expect(
    await screen.findByRole("button", { name: "Copy shared link" }),
  ).toBeEnabled();
  expect(set).toHaveBeenNthCalledWith(1, "doc-3", {
    role: "editor",
    expected_version: 0,
    reset: false,
  });
  expect(set).toHaveBeenNthCalledWith(2, "doc-3", {
    role: "editor",
    expected_version: 2,
    reset: false,
  });
});
