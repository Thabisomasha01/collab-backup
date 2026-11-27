import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  Check,
  CircleAlert,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FolderPlus,
  Plus,
  UserRound,
  UserPlus
} from 'lucide-react';
import type { Project, TaskItem } from '../../types/taskViewer';
import { AnimatedAnalyticsGraphic } from './AnimatedAnalyticsGraphic';
import { PersonAvatar } from './PersonAvatar';
import styles from './ProjectOverview.module.css';

export interface ProjectOverviewProps {
  project: Project;
  allProjects?: Project[];
  tasks: TaskItem[];
  allTasks?: TaskItem[];
  canViewTaskMetrics: boolean;
  onSelectProject?: (projectId: string) => void;
  onOpenProgressAside: (taskId: string | number) => void;
  onToggleTaskDone: (taskId: string | number) => void;
  onCreateSprint?: (projectId: string) => void;
  onInviteMembers?: (projectId: string) => void;
}

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const AnimatedMetric: React.FC<{ value: number }> = ({ value }) => {
  const [displayedValue, setDisplayedValue] = useState(0);
  const displayedValueRef = useRef(0);

  useEffect(() => {
    const startValue = displayedValueRef.current;
    const startTime = performance.now();
    const duration = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 500;
    let frameId = 0;

    const update = (now: number) => {
      const progress = duration === 0 ? 1 : Math.min((now - startTime) / duration, 1);
      const easedProgress = 1 - (1 - progress) ** 3;
      const nextValue = Math.round(startValue + (value - startValue) * easedProgress);
      displayedValueRef.current = nextValue;
      setDisplayedValue(nextValue);
      if (progress < 1) frameId = requestAnimationFrame(update);
    };

    frameId = requestAnimationFrame(update);
    return () => cancelAnimationFrame(frameId);
  }, [value]);

  return <span className={styles['kpi-value']}>{displayedValue}</span>;
};

function formatActivityTime(raw?: string | null): string {
  if (!raw) return 'Recently';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return String(raw);
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit'
  }).format(parsed);
}

function getActivityDateKey(raw?: string | null): string | null {
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(
    parsed.getDate()
  ).padStart(2, '0')}`;
}

function getLocalDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

function getActivityIcon(status: string) {
  switch (status.toLowerCase()) {
    case 'done':
      return CheckCircle2;
    case 'in progress':
      return Clock3;
    case 'blocked':
      return CircleAlert;
    default:
      return FolderPlus;
  }
}

function getActivityTone(status: string): string {
  switch (status.toLowerCase()) {
    case 'done':
      return 'activity-tone-green';
    case 'in progress':
      return 'activity-tone-purple';
    case 'blocked':
      return 'activity-tone-amber';
    default:
      return 'activity-tone-blue';
  }
}

function summarizeProjectDescription(description?: string): string {
  const normalized = description?.replace(/\s+/g, ' ').trim();
  if (!normalized) return 'No project description provided yet.';

  const sentences = normalized.match(/[^.!?]+(?:[.!?]+|$)/g) || [normalized];
  const ranked = sentences
    .map((sentence, index) => {
      const text = sentence.trim();
      const goalMatches = text.match(
        /\b(goal|objective|aim|focus|by the end|deliver|outcome|enable|improve|reduce|provide)\b/gi
      );
      return { text, index, score: goalMatches?.length || 0 };
    })
    .filter(({ text }) => text.length > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 2)
    .sort((a, b) => a.index - b.index);

  const summary = ranked.map(({ text }) => text).join(' ');
  if (summary.length <= 240) return summary;

  const shortened = summary.slice(0, 237);
  const lastSpace = shortened.lastIndexOf(' ');
  return `${shortened.slice(0, lastSpace > 0 ? lastSpace : shortened.length)}…`;
}

export const ProjectOverview: React.FC<ProjectOverviewProps> = ({
  project,
  allProjects,
  tasks,
  canViewTaskMetrics,
  onOpenProgressAside,
  onToggleTaskDone,
  onCreateSprint,
  onInviteMembers
}) => {
  const [taskFilter, setTaskFilter] = useState<'all' | 'pending'>('all');
  const [timeframe, setTimeframe] = useState<'Weekly' | 'Monthly'>('Weekly');
  const [activityUserFilter, setActivityUserFilter] = useState('all');
  const [activityDateFilter, setActivityDateFilter] = useState<
    'today' | 'yesterday' | 'week' | 'all'
  >('today');
  const [showAllActivity, setShowAllActivity] = useState(false);
  const [spotlightOffset, setSpotlightOffset] = useState<number>(0);

  const projectPool = allProjects && allProjects.length > 0 ? allProjects : [project];
  const completedCount = tasks.filter((t) => t.status === 'Done').length;
  const inProgressCount = tasks.filter((t) => t.status === 'In progress').length;
  const todoCount = tasks.filter((t) => t.status === 'To do' || t.status === 'Backlog').length;
  const todayKey = new Date().toISOString().slice(0, 10);
  const dueSoonLimit = new Date(`${todayKey}T00:00:00Z`);
  dueSoonLimit.setUTCDate(dueSoonLimit.getUTCDate() + 7);
  const dueSoonLimitKey = dueSoonLimit.toISOString().slice(0, 10);
  const overdueCount = tasks.filter((task) => {
    const dueDate = (task.date || task.due_date || '').slice(0, 10);
    return dueDate && dueDate < todayKey && task.status !== 'Done';
  }).length;
  const dueSoonCount = tasks.filter((task) => {
    const dueDate = (task.date || task.due_date || '').slice(0, 10);
    return dueDate && dueDate >= todayKey && dueDate <= dueSoonLimitKey && task.status !== 'Done';
  }).length;
  const visibleTasks = useMemo(() => {
    return tasks.filter((t) => (taskFilter === 'pending' ? t.status !== 'Done' : true));
  }, [tasks, taskFilter]);

  const spotlightProjects = useMemo(() => {
    const ordered = [
      project,
      ...projectPool.filter((p) => p.projectId !== project.projectId)
    ];
    if (ordered.length <= 1) return ordered;
    const start = spotlightOffset % ordered.length;
    return [ordered[start], ordered[(start + 1) % ordered.length]];
  }, [project, projectPool, spotlightOffset]);
  const detailsProject = spotlightProjects[0] || project;
  const showPreviousProject = () =>
    setSpotlightOffset((prev) =>
      prev === 0 ? Math.max(0, projectPool.length - 1) : prev - 1
    );
  const showNextProject = () => setSpotlightOffset((prev) => prev + 1);

  const activityItems = useMemo(() => {
    const now = new Date();
    const todayKey = getLocalDateKey(now);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayKey = getLocalDateKey(yesterday);
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - 6);
    weekStart.setHours(0, 0, 0, 0);

    return tasks
      .map((task, index) => {
        const id = `act-${task.id}`;
        const rawTime = task.updatedAt || task.createdAt;
        const dateKey = getActivityDateKey(rawTime) || (index < 2 ? todayKey : yesterdayKey);
        const status = task.status || 'To do';
        const assigneeUid = String(task.assigneeFirebaseUid || task.assignee_firebase_uid || '');
        return {
          id,
          title: task.title,
          time: formatActivityTime(rawTime),
          detail: `${status}${task.sprint ? ` · ${task.sprint}` : ''}`,
          status,
          dateKey,
          assigneeUid,
          assigneeName: task.assigneeName || 'Unassigned',
          rawTime
        };
      })
      .filter((item) => {
        if (activityUserFilter !== 'all' && item.assigneeUid !== activityUserFilter) return false;
        if (activityDateFilter === 'today' && item.dateKey !== todayKey) return false;
        if (activityDateFilter === 'yesterday' && item.dateKey !== yesterdayKey) return false;
        if (activityDateFilter === 'week') {
          const date = item.rawTime ? new Date(item.rawTime) : new Date(`${item.dateKey}T12:00:00`);
          if (Number.isNaN(date.getTime()) || date < weekStart || date > now) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const timeA = a.rawTime ? new Date(a.rawTime).getTime() : 0;
        const timeB = b.rawTime ? new Date(b.rawTime).getTime() : 0;
        return timeB - timeA;
      });
  }, [tasks, activityUserFilter, activityDateFilter]);

  const activityUsers = useMemo(() => {
    const uniqueUsers = new Map<string, string>();
    tasks.forEach((task) => {
      const uid = String(task.assigneeFirebaseUid || task.assignee_firebase_uid || '');
      if (uid) uniqueUsers.set(uid, task.assigneeName || 'Project member');
    });
    return [...uniqueUsers.entries()];
  }, [tasks]);

  const visibleActivityItems = showAllActivity ? activityItems : activityItems.slice(0, 3);

  const chartData = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    tasks.forEach((t, index) => {
      const raw = t.updatedAt || t.createdAt || t.due_date || t.date;
      let dayIdx = index % 7;
      if (raw) {
        const parsed = new Date(raw);
        if (!Number.isNaN(parsed.getTime())) {
          const jsDay = parsed.getDay();
          dayIdx = jsDay === 0 ? 6 : jsDay - 1;
        }
      }
      counts[dayIdx] += t.status === 'Done' ? 2 : t.status === 'In progress' ? 1.5 : 1;
    });
    const multiplier = timeframe === 'Monthly' ? 1.25 : 1;
    return DAY_LABELS.map((day, idx) => ({
      day,
      val: Number(Math.min(8, counts[idx] * multiplier).toFixed(1))
    }));
  }, [tasks, timeframe]);

  return (
    <div className={styles['overview-canvas']}>
      <div className={styles['overview-layout']}>
        {/* LEFT MAIN COLUMN */}
        <div className={styles['main-col']}>
          {/* Task metric cards */}
          <div className={styles['metrics-section']}>
            {(onInviteMembers || onCreateSprint) && (
              <div className={styles['metrics-actions']}>
                {onInviteMembers && (
                  <button
                    type="button"
                    className={styles['create-task-button']}
                    onClick={() => onInviteMembers(project.projectId)}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="1em"
                      height="1em"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                    >
                      <path
                        fill="currentColor"
                        d="M17 9c0-1.381-.56-2.631-1.464-3.535C14.631 4.56 13.381 4 12 4s-2.631.56-3.536 1.465C7.56 6.369 7 7.619 7 9s.56 2.631 1.464 3.535C9.369 13.44 10.619 14 12 14s2.631-.56 3.536-1.465A4.98 4.98 0 0 0 17 9M6 19c0 1 2.25 2 6 2c3.518 0 6-1 6-2c0-2-2.354-4-6-4c-3.75 0-6 2-6 4"
                      />
                    </svg>
                    Invite Members
                  </button>
                )}
                {onInviteMembers && onCreateSprint && (
                  <span className={styles['metrics-action-divider']} aria-hidden="true">
                    |
                  </span>
                )}
                {onCreateSprint && (
                  <button
                    type="button"
                    className={styles['create-task-button']}
                    onClick={() => onCreateSprint(project.projectId)}
                  >
                    <Plus size={14} strokeWidth={2.5} />
                    Create Sprint
                  </button>
                )}
              </div>
            )}
            {canViewTaskMetrics && (
              <section className={styles['kpi-grid']} aria-label="Project Metrics">
                <div className={styles['kpi-card']}>
                  <div className={styles['kpi-count-row']}>
                    <AnimatedMetric value={tasks.length} />
                    <AnimatedAnalyticsGraphic />
                  </div>
                  <span className={styles['kpi-label']}>Total tasks</span>
                </div>
                <div className={styles['kpi-card']}>
                  <div className={styles['kpi-count-row']}>
                    <AnimatedMetric value={todoCount} />
                    <AnimatedAnalyticsGraphic variant="pending" />
                  </div>
                  <span className={styles['kpi-label']}>Pending tasks</span>
                </div>
                <div className={styles['kpi-card']}>
                  <div className={styles['kpi-count-row']}>
                    <AnimatedMetric value={inProgressCount} />
                    <AnimatedAnalyticsGraphic variant="in-progress" />
                  </div>
                  <span className={styles['kpi-label']}>In progress</span>
                </div>
                <div className={styles['kpi-card']}>
                  <div className={styles['kpi-count-row']}>
                    <AnimatedMetric value={completedCount} />
                    <AnimatedAnalyticsGraphic variant="complete" />
                  </div>
                  <span className={styles['kpi-label']}>Complete tasks</span>
                </div>
                <div className={styles['kpi-card']}>
                  <div className={styles['kpi-count-row']}>
                    <AnimatedMetric value={overdueCount} />
                    <AnimatedAnalyticsGraphic variant="overdue" />
                  </div>
                  <span className={styles['kpi-label']}>Overdue tasks</span>
                </div>
                <div className={styles['kpi-card']}>
                  <div className={styles['kpi-count-row']}>
                    <AnimatedMetric value={dueSoonCount} />
                    <AnimatedAnalyticsGraphic variant="due-soon" />
                  </div>
                  <span className={styles['kpi-label']}>Due soon</span>
                </div>
              </section>
            )}
          </div>

          {/* Full Project Descriptions + Assignees Card */}
          <section
            className={`${styles['details-strip-card']} ${styles['details-strip-overview']}`}
            aria-label="Project Descriptions and Assignees"
          >
            <div className={styles['details-strip-split']}>
              <div>
                <h3 className={styles['details-block-title']}>Project Descriptions</h3>
                <p className={styles['details-block-copy']}>
                  {project.description || 'No project description provided yet.'}
                </p>
              </div>
              <div className={styles['details-assignee-col']}>
                <div className={styles['details-project-overview']}>
                  <div className={`${styles['section-bar']} ${styles['details-overview-controls']}`}>
                    <div className={styles['carousel-controls']}>
                      <button
                        type="button"
                        className={styles['carousel-btn']}
                        aria-label="Previous project"
                        onClick={showPreviousProject}
                      >
                        <ChevronLeft size={15} />
                      </button>
                      <button
                        type="button"
                        className={styles['carousel-btn']}
                        aria-label="Next project"
                        onClick={showNextProject}
                      >
                        <ChevronRight size={15} />
                      </button>
                    </div>
                  </div>
                  <div className={styles['details-overview-content']}>
                    <div className={styles['spotlight-info']}>
                      <span className={styles['spotlight-kicker']}>
                        {detailsProject.sprints?.[0]?.name || 'Active Sprint'}
                      </span>
                      <h3 className={styles['spotlight-title']}>{detailsProject.name}</h3>
                      <p className={styles['spotlight-desc']}>
                        {summarizeProjectDescription(detailsProject.description)}
                      </p>
                      <span className={styles['team-label']}>Project Members</span>
                      <div className={styles['team-row']}>
                        <div className={styles['team-avatar-stack']}>
                          {detailsProject.acceptedMembers.slice(0, 4).map((member, idx) => (
                            <span
                              key={member.uid || member.email || idx}
                              className={styles['team-avatar-item']}
                            >
                              <PersonAvatar person={member} size={24} />
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>

                  </div>
                </div>
              </div>
            </div>
          </section>

          {/*  */}

          {/* Bottom Split: Task Progress + Recent  Tasks */}
          <div className={styles['bottom-split-grid']}>
            {/* Task Progress Card */}
            {canViewTaskMetrics && (
              <section
                className={`${styles['panel-card']} ${styles['progress-panel']}`}
                aria-label="Task Progress"
              >
                <div className={`${styles['panel-head']} ${styles['panel-card-header']}`}>
                  <h2 className={styles['section-heading']}>Task Progress</h2>
                  <select
                    className={styles['select-pill']}
                    value={timeframe}
                    aria-label="Select progress timeframe"
                    onChange={(e) => setTimeframe(e.target.value as 'Weekly' | 'Monthly')}
                  >
                    <option value="Weekly">Weekly</option>
                    <option value="Monthly">Monthly</option>
                  </select>
                </div>

                <div className={styles['progress-panel-body']}>
                  <div className={styles['progress-metrics-row']}>
                    <div className={styles['progress-metric']}>
                      <strong>{completedCount}</strong>
                      <span>Completed</span>
                    </div>
                    <div className={styles['progress-metric']}>
                      <strong>{inProgressCount}</strong>
                      <span>In Progress</span>
                    </div>
                    <div className={styles['progress-metric']}>
                      <strong>{todoCount}</strong>
                      <span>To Do</span>
                    </div>
                  </div>

                  <div className={styles['chart-area']}>
                    <div className={styles['chart-y-axis']} aria-hidden="true">
                      <span>8</span>
                      <span>6</span>
                      <span>4</span>
                      <span>2</span>
                      <span>0</span>
                    </div>
                    <div className={styles['chart-bars-wrap']}>
                      <div className={styles['chart-grid-lines']} aria-hidden="true">
                        <span className={styles['chart-grid-line']} />
                        <span className={styles['chart-grid-line']} />
                        <span className={styles['chart-grid-line']} />
                        <span className={styles['chart-grid-line']} />
                        <span className={styles['chart-grid-line']} />
                      </div>
                      {chartData.map((bar) => (
                        <div key={bar.day} className={styles['chart-bar-col']}>
                          <span className={styles['chart-tooltip']}>{bar.val}h</span>
                          <div
                            className={styles['chart-bar']}
                            style={{ height: `${Math.min(100, (bar.val / 8) * 100)}%` }}
                          />
                          <span className={styles['chart-day-label']}>{bar.day}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </section>
            )}

            {/* Recent Tasks Card */}
            <section
              className={`${styles['panel-card']} ${styles['recent-tasks-panel']}`}
              aria-label="Recent Tasks"
            >
              <div className={`${styles['panel-head']} ${styles['panel-card-header']}`}>
                <h2 className={styles['section-heading']}>Recent Tasks</h2>
                <div className={styles['mini-filter-group']}>
                  <button
                    type="button"
                    className={`${styles['mini-filter-btn']} ${
                      taskFilter === 'all' ? styles['is-active'] : ''
                    }`}
                    onClick={() => setTaskFilter('all')}
                  >
                    All ({tasks.length})
                  </button>
                  <button
                    type="button"
                    className={`${styles['mini-filter-btn']} ${
                      taskFilter === 'pending' ? styles['is-active'] : ''
                    }`}
                    onClick={() => setTaskFilter('pending')}
                  >
                    Pending
                  </button>
                </div>
              </div>

              <div className={styles['recent-tasks-panel-body']}>
                <div className={styles['recent-tasks-list']}>
                  {visibleTasks.length === 0 ? (
                    <div className={styles['empty-state-box']}>
                      {taskFilter === 'pending'
                        ? 'All tasks in this project are completed.'
                        : 'No tasks in this project yet.'}
                    </div>
                  ) : (
                    visibleTasks.map((task) => {
                      const isDone = task.status === 'Done';
                      const people = task.assignees || [];
                      const ActivityIcon = getActivityIcon(task.status);
                      const dueDate = task.due && task.due !== '—' ? task.due : 'Not scheduled';
                      const assignee = people[0];

                      return (
                        <article
                          key={String(task.id)}
                          className={styles['recent-task-tile']}
                        >
                          <div className={styles['recent-task-timeline-marker']}>
                            <button
                              type="button"
                              className={`${styles['recent-task-status-icon']} ${
                                styles[getActivityTone(task.status)]
                              }`}
                              aria-label={`Mark ${task.title} ${isDone ? 'not done' : 'done'}`}
                              onClick={() => onToggleTaskDone(task.id)}
                            >
                              {isDone ? <Check size={13} strokeWidth={2.5} /> : <ActivityIcon size={13} />}
                            </button>
                          </div>

                          <div className={styles['recent-task-card']}>
                            <div className={styles['recent-task-card-heading']}>
                              <div className={styles['recent-task-card-title-wrap']}>
                                <button
                                  type="button"
                                  className={`${styles['recent-task-name']} ${
                                    isDone ? styles['is-done'] : ''
                                  }`}
                                  title={task.title}
                                  onClick={() => onOpenProgressAside(task.id)}
                                >
                                  {task.title}
                                </button>
                                <span
                                  className={`${styles['recent-task-status-pill']} ${
                                    styles[getActivityTone(task.status)]
                                  }`}
                                >
                                  {task.status}
                                </span>
                                {task.priority && task.priority !== 'none' && (
                                  <span className={styles['recent-task-priority-pill']}>
                                    {task.priority}
                                  </span>
                                )}
                              </div>
                              <button
                                type="button"
                                className={styles['recent-task-open-btn']}
                                onClick={() => onOpenProgressAside(task.id)}
                              >
                                <span>Open</span>
                                <ChevronRight size={12} />
                              </button>
                            </div>

                            {task.description?.trim() && (
                              <p className={styles['recent-task-description']}>
                                {task.description.trim()}
                              </p>
                            )}

                            <div className={styles['recent-task-details']}>
                              <div className={styles['recent-task-detail']}>
                                <span>Due date</span>
                                <strong>{dueDate}</strong>
                              </div>
                              <div className={styles['recent-task-detail']}>
                                <span>Sprint</span>
                                <strong>{task.sprint || 'Unassigned'}</strong>
                              </div>
                              <div className={styles['recent-task-detail']}>
                                <span>Assignee</span>
                                <div className={styles['recent-task-assignee']}>
                                  {assignee ? (
                                    <>
                                      <PersonAvatar person={assignee} size={18} />
                                      <strong>{assignee.name || assignee.email || 'Member'}</strong>
                                    </>
                                  ) : (
                                    <>
                                      <UserPlus size={13} />
                                      <strong>Unassigned</strong>
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </article>
                      );
                    })
                  )}
                </div>
              </div>
            </section>

            <aside
              className={`${styles['panel-card']} ${styles['right-col']}`}
              aria-label="Recent Activity"
            >
              <div className={styles['activity-header']}>
                <h2 className={styles['section-heading']}>Recent Activity</h2>
                <div className={styles['activity-controls']}>
                  <label className={styles['activity-filter']} aria-label="Filter by date">
                    <CalendarDays size={12} aria-hidden="true" />
                    <select
                      value={activityDateFilter}
                      onChange={(event) =>
                        setActivityDateFilter(
                          event.target.value as 'today' | 'yesterday' | 'week' | 'all'
                        )
                      }
                    >
                      <option value="today">Today</option>
                      <option value="yesterday">Yesterday</option>
                      <option value="week">Last 7 days</option>
                      <option value="all">All time</option>
                    </select>
                  </label>
                </div>
              </div>

              <div className={styles['activity-timeline']}>
                <div className={styles['activity-group-label']}>
                  {activityDateFilter === 'today'
                    ? 'Today'
                    : activityDateFilter === 'yesterday'
                      ? 'Yesterday'
                      : activityDateFilter === 'week'
                        ? 'Last 7 days'
                        : 'All activity'}
                </div>
                {visibleActivityItems.length > 0 ? (
                  <div className={styles['activity-timeline-list']}>
                    {visibleActivityItems.map((item) => {
                      const ActivityIcon = getActivityIcon(item.status);
                      return (
                        <div key={item.id} className={styles['activity-timeline-item']}>
                          <span
                            className={`${styles['activity-timeline-icon']} ${
                              styles[getActivityTone(item.status)]
                            }`}
                            aria-hidden="true"
                          >
                            <ActivityIcon size={13} strokeWidth={2} />
                          </span>
                          <div className={styles['activity-timeline-content']}>
                            <span className={styles['activity-timeline-text']}>
                              {item.title}
                              <span> — {item.detail}</span>
                            </span>
                            <time>{item.time}</time>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className={styles['activity-empty']}>
                    No recent activity to display for this filter.
                  </div>
                )}
              </div>

              {activityItems.length > 3 && (
                <button
                  type="button"
                  className={styles['activity-view-all']}
                  onClick={() => setShowAllActivity((shown) => !shown)}
                >
                  {showAllActivity ? 'Show Less' : 'View All'}
                </button>
              )}
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
};
