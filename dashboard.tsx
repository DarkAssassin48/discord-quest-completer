/* SPDX-License-Identifier: MIT; Copyright (c) 2026 nyxxbit and contributors */
import "./dashboard.css";

import ErrorBoundary from "@components/ErrorBoundary";
import { findComponentByCodeLazy } from "@webpack";
import { React } from "@webpack/common";

import { toggleDashboard } from "./dashboardView";

export { destroyDashboard, hideDashboard, initializeDashboard, showDashboard, toggleDashboard } from "./dashboardView";

const HeaderBarIcon = findComponentByCodeLazy(".HEADER_BAR_BADGE_BOTTOM,", 'position:"bottom"');

export const renderToolbarButton = ErrorBoundary.wrap(() => (
    <HeaderBarIcon
        className="orion-ru-toolbar-button"
        tooltip="Orion — задания"
        onClick={toggleDashboard}
        icon={() => <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M13.5 2 4 13h6l-1 9 11-13h-7z" /></svg>}
    />
), { noop: true });
