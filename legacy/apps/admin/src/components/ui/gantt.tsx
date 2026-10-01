'use client';

import {
  DndContext,
  MouseSensor,
  useDraggable,
  useSensor,
} from '@dnd-kit/core';
import { restrictToHorizontalAxis } from '@dnd-kit/modifiers';
import { useMouse, useThrottle, useWindowScroll } from '@uidotdev/usehooks';
import {
  addDays,
  addMonths,
  differenceInDays,
  differenceInHours,
  differenceInMonths,
  endOfDay,
  endOfMonth,
  format,
  formatDate,
  formatDistance,
  getDate,
  getDaysInMonth,
  isSameDay,
  startOfDay,
  startOfMonth,
} from 'date-fns';
import { atom, useAtom } from 'jotai';
import throttle from 'lodash.throttle';
import { PlusIcon, TrashIcon } from 'lucide-react';
import type {
  CSSProperties,
  FC,
  KeyboardEventHandler,
  MouseEventHandler,
  ReactNode,
  RefObject,
} from 'react';
import {
  createContext,
  memo,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Card } from '@/components/ui/card';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';

const draggingAtom = atom(false);
const scrollXAtom = atom(0);

export const useGanttDragging = () => useAtom(draggingAtom);
export const useGanttScrollX = () => useAtom(scrollXAtom);

export type GanttStatus = {
  id: string;
  name: string;
  color: string;
};

export type GanttFeature = {
  id: string;
  name: string;
  startAt: Date;
  endAt: Date;
  status: GanttStatus;
  lane?: string;
};

export type GanttMarkerProps = {
  id: string;
  date: Date;
  label: string;
};

export type Range = 'daily' | 'monthly' | 'quarterly';

export type TimelineData = {
  year: number;
  quarters: {
    months: {
      days: number;
    }[]
  }[];
}[];

export type GanttContextProps = {
  zoom: number;
  range: Range;
  columnWidth: number;
  sidebarWidth: number;
  headerHeight: number;
  rowHeight: number;
  onAddItem: ((date: Date) => void) | undefined;
  placeholderLength: number;
  timelineData: TimelineData;
  ref: RefObject<HTMLDivElement | null> | null;
  scrollToFeature?: (feature: GanttFeature) => void;
};

const GanttContext = createContext<GanttContextProps>({
  zoom: 100,
  range: 'monthly',
  columnWidth: 50,
  headerHeight: 60,
  sidebarWidth: 300,
  rowHeight: 36,
  onAddItem: undefined,
  placeholderLength: 2,
  timelineData: [],
  ref: null,
  scrollToFeature: undefined,
});

// Temporarily export a simple stub - full implementation would be very large
export const GanttProvider: FC<{
  range?: Range;
  zoom?: number;
  onAddItem?: (date: Date) => void;
  children: ReactNode;
  className?: string;
}> = ({ children, className }) => {
  return (
    <div className={cn('h-full w-full p-4', className)}>
      <div className="text-center text-gray-600">
        <p className="text-lg font-semibold">Gantt Chart (Coming Soon)</p>
        <p className="text-sm mt-2">The shadcn/ui Gantt component is being integrated.</p>
        <p className="text-sm mt-4">For now, please use the Kanban view for task management.</p>
      </div>
      {children}
    </div>
  );
};

// Export placeholder components for now
export const GanttSidebar: FC<{ children: ReactNode; className?: string }> = ({ children }) => <div>{children}</div>;
export const GanttSidebarGroup: FC<{ name: string; children: ReactNode; className?: string }> = ({ children }) => <div>{children}</div>;
export const GanttSidebarItem: FC<any> = () => null;
export const GanttTimeline: FC<{ children: ReactNode; className?: string }> = ({ children }) => <div>{children}</div>;
export const GanttHeader: FC<{ className?: string }> = () => null;
export const GanttFeatureList: FC<{ children: ReactNode; className?: string }> = ({ children }) => <div>{children}</div>;
export const GanttFeatureListGroup: FC<{ children: ReactNode; className?: string }> = ({ children }) => <div>{children}</div>;
export const GanttFeatureRow: FC<any> = () => null;
export const GanttToday: FC<{ className?: string }> = () => null;
export const GanttMarker: FC<any> = () => null;
