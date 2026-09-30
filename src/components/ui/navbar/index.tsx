"use client";

import Link from "next/link";
import { ChevronDown } from "lucide-react";
import type { MouseEvent } from "react";
import { NavItem } from "./types";

export const NavbarLink = ({ item, isFocusMode }: { item: NavItem; isFocusMode: boolean }) => (
    <Link
        className={`navbar-item ${isFocusMode ? "navbar-item-hidden" : ""}`}
        href={item.href || "#"}
    >
        <span className="inline-flex items-center gap-1.5">
            <item.icon className="w-4 h-4" aria-hidden />
            <span>{item.label}</span>
        </span>
    </Link>
);

export const NavbarDropdownTrigger = ({
    item,
    isActive,
    isFocusMode,
    toggleDropdown,
}: {
    item: NavItem;
    isActive: boolean;
    isFocusMode: boolean;
    toggleDropdown: (id: string) => void;
}) => (
    <div
        className={`navbar-dropdown ${isActive ? "navbar-dropdown-active" : ""} ${isFocusMode && !isActive ? "navbar-item-hidden" : ""}`}
    >
        <button
            className="navbar-dropdown-trigger hover:underline"
            onClick={(e) => {
                e.stopPropagation();
                toggleDropdown(item.id);
            }}
        >
            <span className="inline-flex items-center gap-1.5">
                <item.icon className="w-4 h-4" aria-hidden />
                <span>{item.label}</span>
                <ChevronDown
                    className={`w-3 h-3 transition-transform ${isActive ? "rotate-180" : ""}`}
                    aria-hidden
                />
            </span>
        </button>
    </div>
);

export const DropdownMenu = ({
    item,
    activeDropdown,
    isCompressed,
    inline = false,
}: {
    item: NavItem;
    activeDropdown: string | null;
    isCompressed: boolean;
    /** Render the menu bare (no fixed floating container) so it can fill
     *  the folded nav pad when it morphs into a panel. */
    inline?: boolean;
}) => {
    // Pointer-position light spill: the closer the cursor is to the edge
    // shared with a neighbour, the brighter that neighbour's reflection.
    // Attached as props (not an effect) so it's live on every open —
    // an effect with [] deps ran while the menu was still unmounted and
    // never re-attached.
    const onPointerMove = (e: MouseEvent<HTMLDivElement>) => {
        const item = (e.target as HTMLElement).closest<HTMLElement>(
            ".navbar-dropdown-item"
        );
        if (!item) return;
        const r = item.getBoundingClientRect();
        const EDGE_ZONE = 80; // px from an edge where the spill ramps up
        const spill = (d: number) => (0.08 + Math.max(0, 1 - d / EDGE_ZONE) * 0.34).toFixed(3);
        e.currentTarget.style.setProperty("--spill-prev", spill(e.clientX - r.left));
        e.currentTarget.style.setProperty("--spill-next", spill(r.right - e.clientX));
    };

    const onPointerLeave = (e: MouseEvent<HTMLDivElement>) => {
        e.currentTarget.style.removeProperty("--spill-prev");
        e.currentTarget.style.removeProperty("--spill-next");
    };

    if (activeDropdown !== item.id || isCompressed || !item.dropdownContent) return null;

    const menu = (
        <div
            className="navbar-dropdown-menu"
            onMouseMove={onPointerMove}
            onMouseLeave={onPointerLeave}
        >
            {item.dropdownContent.map((section, idx) => (
                <div key={idx} className="dropdown-section">
                    <div className="dropdown-subcategory">{section.title}</div>
                    <div className="dropdown-items-row">
                        {section.items.map((dropItem, dIdx) => (
                            <Link key={dIdx} href={dropItem.href} className="navbar-dropdown-item">
                                <dropItem.icon className="w-4 h-4" aria-hidden />
                                <span>{dropItem.label}</span>
                            </Link>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );

    if (inline) return menu;

    return (
        <div className="dropdown-menu-container dropdown-expanded">
            {menu}
        </div>
    );
};

export * from "./types";
