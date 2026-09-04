import { useMemo, useState, type ReactNode } from "react";
import { Check, ChevronsUpDown, UserCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { HubUser } from "@/lib/hub-store";
import { cn } from "@/lib/utils";

export function UserAvatar({
  picture,
  name,
  size = 40,
  className,
}: {
  picture?: string;
  name: string;
  size?: number;
  className?: string;
}) {
  if (picture) {
    return (
      <img
        src={picture}
        alt=""
        className={cn("shrink-0 rounded-lg object-cover object-top bg-muted", className)}
        style={{ width: size, height: size }}
        draggable={false}
      />
    );
  }
  return (
    <div
      className={cn(
        "shrink-0 rounded-lg bg-muted flex items-center justify-center text-muted-foreground",
        className,
      )}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <UserCircle2 style={{ width: size * 0.72, height: size * 0.72 }} />
    </div>
  );
}

function UserFieldRow({
  user,
  variant = "list",
}: {
  user: Pick<HubUser, "name" | "picture">;
  variant?: "list" | "trigger";
}) {
  const list = variant === "list";
  return (
    <div className={cn("flex items-center w-full min-w-0", list ? "gap-3" : "gap-2.5")}>
      <div className="min-w-0 text-left flex-1">
        <div className={cn("truncate leading-tight", list ? "text-sm font-medium" : "font-semibold")}>
          {user.name}
        </div>
      </div>
      <UserAvatar picture={user.picture} name={user.name} size={list ? 36 : 40} />
    </div>
  );
}

function userByName(users: HubUser[], name: string): Pick<HubUser, "id" | "name" | "picture"> {
  return users.find((u) => u.name === name) ?? { id: name, name };
}

function filterUsers(users: HubUser[], query: string, extraName?: string) {
  const q = query.trim().toLowerCase();
  const list = q
    ? users.filter(
        (u) => u.name.toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q),
      )
    : users;
  if (extraName && !list.some((u) => u.name === extraName) && (!q || extraName.toLowerCase().includes(q))) {
    return { list, orphan: extraName };
  }
  return { list, orphan: undefined as string | undefined };
}

/** Inline panel — stays inside the parent dialog. No portal, so taps cannot close the modal. */
function UserPickerPanel({
  query,
  onQueryChange,
  children,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="rounded-md border bg-popover overflow-hidden">
      <div className="p-2 border-b">
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.preventDefault();
          }}
          placeholder="Search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>
      <div
        className="max-h-60 overflow-y-auto overscroll-contain touch-pan-y"
        data-scroll-lock-scrollable=""
        onWheel={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

function UserPickButton({
  children,
  onPick,
}: {
  children: ReactNode;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center px-3 py-2 hover:bg-accent text-left"
      onClick={onPick}
    >
      {children}
    </button>
  );
}

interface UsersSingleSelectProps {
  users: HubUser[];
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
  compact?: boolean;
  className?: string;
}

export function UsersSingleSelect({
  users,
  value,
  onChange,
  placeholder = "Select technician…",
  compact,
  className,
}: UsersSingleSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = value ? userByName(users, value) : null;
  const { list, orphan } = useMemo(
    () => filterUsers(users, query, value || undefined),
    [users, query, value],
  );

  if (users.length === 0 && !value) {
    return <p className="text-sm text-muted-foreground">No users available.</p>;
  }

  const pick = (name: string) => {
    onChange(name);
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        aria-expanded={open}
        className={cn(
          "w-full justify-between h-auto min-h-10 py-1.5 px-2",
          compact && "min-h-8 py-1",
          className,
        )}
        onClick={() => setOpen((v) => !v)}
      >
        {selected ? (
          <UserFieldRow user={selected} variant="trigger" />
        ) : (
          <span className="text-muted-foreground text-sm">{placeholder}</span>
        )}
        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50 ml-2" />
      </Button>
      {open ? (
        <UserPickerPanel query={query} onQueryChange={setQuery}>
          {list.length === 0 && !orphan ? (
            <p className="px-3 py-6 text-sm text-center text-muted-foreground">No users found.</p>
          ) : (
            <>
              {list.map((u) => (
                <UserPickButton key={u.id} onPick={() => pick(u.name)}>
                  <UserFieldRow user={u} />
                </UserPickButton>
              ))}
              {orphan ? (
                <UserPickButton onPick={() => pick(orphan)}>
                  <UserFieldRow user={{ name: orphan }} />
                </UserPickButton>
              ) : null}
            </>
          )}
        </UserPickerPanel>
      ) : null}
    </div>
  );
}

interface UsersMultiSelectProps {
  users: HubUser[];
  value: string[];
  onChange: (v: string[]) => void;
  compact?: boolean;
  className?: string;
}

export function UsersMultiSelect({
  users,
  value,
  onChange,
  compact,
  className,
}: UsersMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const { list } = useMemo(() => filterUsers(users, query), [users, query]);

  if (users.length === 0 && value.length === 0) {
    return <p className="text-sm text-muted-foreground">No users available.</p>;
  }

  const toggle = (name: string) => {
    if (value.includes(name)) onChange(value.filter((n) => n !== name));
    else onChange([...value, name]);
  };

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        aria-expanded={open}
        className={cn("w-full justify-between h-auto min-h-10 py-1.5", compact && "min-h-8 py-1", className)}
        onClick={() => setOpen((v) => !v)}
      >
        <div className="flex flex-wrap gap-1 items-center min-w-0">
          {value.length === 0 ? (
            <span className="text-muted-foreground">Select users…</span>
          ) : (
            value.map((name) => {
              const u = userByName(users, name);
              return (
                <Badge key={name} variant="secondary" className="gap-1.5 pl-1 pr-1.5 pointer-events-none">
                  <UserAvatar picture={u.picture} name={name} size={18} className="rounded-sm" />
                  {name}
                </Badge>
              );
            })
          )}
        </div>
        <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50 ml-2" />
      </Button>
      {open ? (
        <UserPickerPanel query={query} onQueryChange={setQuery}>
          {list.length === 0 ? (
            <p className="px-3 py-6 text-sm text-center text-muted-foreground">No users found.</p>
          ) : (
            list.map((u) => {
              const selected = value.includes(u.name);
              return (
                <UserPickButton key={u.id} onPick={() => toggle(u.name)}>
                  <Check className={`mr-2 h-4 w-4 shrink-0 ${selected ? "opacity-100" : "opacity-0"}`} />
                  <UserFieldRow user={u} />
                </UserPickButton>
              );
            })
          )}
        </UserPickerPanel>
      ) : null}
    </div>
  );
}
