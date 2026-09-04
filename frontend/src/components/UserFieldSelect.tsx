import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronsUpDown, UserCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
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
      aria-label={name}
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

function useCoarsePointer() {
  const [coarse, setCoarse] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    const apply = () => setCoarse(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return coarse;
}

function UsersPickerPopover({
  open,
  onOpenChange,
  trigger,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  children: ReactNode;
}) {
  const coarse = useCoarsePointer();
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {trigger}
      <PopoverContent
        align="start"
        collisionPadding={12}
        onOpenAutoFocus={(e) => {
          if (coarse) e.preventDefault();
        }}
        className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-1rem)] min-w-0 p-0 overflow-hidden"
      >
        <Command
          disablePointerSelection={coarse}
          className="flex h-auto max-h-[min(24rem,var(--radix-popover-content-available-height))] flex-col overflow-hidden"
        >
          <CommandInput placeholder="Search" />
          <CommandList className="max-h-none min-h-0 flex-1 overflow-y-auto overscroll-contain touch-pan-y [-webkit-overflow-scrolling:touch]">
            {children}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
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
  const selected = value ? userByName(users, value) : null;

  if (users.length === 0 && !value) {
    return <p className="text-sm text-muted-foreground">No users available.</p>;
  }

  return (
    <UsersPickerPopover
      open={open}
      onOpenChange={setOpen}
      trigger={
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn(
              "w-full justify-between h-auto min-h-10 py-1.5 px-2",
              compact && "min-h-8 py-1",
              className,
            )}
          >
            {selected ? (
              <UserFieldRow user={selected} variant="trigger" />
            ) : (
              <span className="text-muted-foreground text-sm">{placeholder}</span>
            )}
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50 ml-2" />
          </Button>
        </PopoverTrigger>
      }
    >
      <CommandEmpty>No users found.</CommandEmpty>
      <CommandGroup>
        {users.map((u) => (
          <CommandItem
            key={u.id}
            value={`${u.name} ${u.email ?? ""}`}
            onSelect={() => {
              onChange(u.name);
              setOpen(false);
            }}
            className="items-center py-2 px-3 [&_svg]:size-auto"
          >
            <UserFieldRow user={u} />
          </CommandItem>
        ))}
        {value && !users.some((u) => u.name === value) && (
          <CommandItem
            value={value}
            onSelect={() => {
              onChange(value);
              setOpen(false);
            }}
            className="items-center py-2 px-3 [&_svg]:size-auto"
          >
            <UserFieldRow user={{ name: value }} />
          </CommandItem>
        )}
      </CommandGroup>
    </UsersPickerPopover>
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

  if (users.length === 0 && value.length === 0) {
    return <p className="text-sm text-muted-foreground">No users available.</p>;
  }

  const toggle = (name: string) => {
    if (value.includes(name)) onChange(value.filter((n) => n !== name));
    else onChange([...value, name]);
  };

  return (
    <UsersPickerPopover
      open={open}
      onOpenChange={setOpen}
      trigger={
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn("w-full justify-between h-auto min-h-10 py-1.5", compact && "min-h-8 py-1", className)}
          >
            <div className="flex flex-wrap gap-1 items-center min-w-0">
              {value.length === 0 ? (
                <span className="text-muted-foreground">Select users…</span>
              ) : (
                value.map((name) => {
                  const u = userByName(users, name);
                  return (
                    <Badge key={name} variant="secondary" className="gap-1.5 pl-1 pr-1.5">
                      <UserAvatar picture={u.picture} name={name} size={18} className="rounded-sm" />
                      {name}
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(name);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            e.stopPropagation();
                            toggle(name);
                          }
                        }}
                        className="hover:text-destructive cursor-pointer inline-flex"
                      >
                        <X className="h-3 w-3" />
                      </span>
                    </Badge>
                  );
                })
              )}
            </div>
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50 ml-2" />
          </Button>
        </PopoverTrigger>
      }
    >
      <CommandEmpty>No users found.</CommandEmpty>
      <CommandGroup>
        {users.map((u) => {
          const selected = value.includes(u.name);
          return (
            <CommandItem
              key={u.id}
              value={`${u.name} ${u.email ?? ""}`}
              onSelect={() => toggle(u.name)}
              className="items-center py-2 px-3 [&_svg]:size-auto"
            >
              <Check
                className={`mr-2 h-4 w-4 shrink-0 ${selected ? "opacity-100" : "opacity-0"}`}
              />
              <UserFieldRow user={u} />
            </CommandItem>
          );
        })}
      </CommandGroup>
    </UsersPickerPopover>
  );
}
