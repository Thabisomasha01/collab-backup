import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import {
  getSprintMembers,
  normalizeTaskRecord,
  useDashboard
} from '../../context/DashboardContext';
import { api } from '../../services/api';
import type { Project, ProjectMember, TaskItem } from '../../types/dashboard';
import type {
  BoardCardItem,
  BoardColumnStatus,
  TaskAttachment,
  TaskComment,
  TaskItem as ViewerTaskItem,
  TaskSubtask
} from '../../types/taskViewer';
import { ProjectOverview } from './ProjectOverview';
import { TaskDetails } from './TaskDetails';
import drawerStyles from './TaskDrawer.module.css';

type OverviewTask = TaskItem & { assignees: ProjectMember[] };

function getOverviewTask(task: TaskItem, project: Project): OverviewTask {
  const sprint = project.sprints.find((item) => item.name === task.sprint);
  const sprintMembers = sprint ? getSprintMembers(project, sprint) : [];
  const projectMembers: ProjectMember[] = [
    ...(project.creatorFirebaseUid
      ? [
          {
            firebaseUid: project.creatorFirebaseUid,
            name: project.creatorName,
            email: project.creatorEmail,
            profileImage: project.creatorProfileImage
          }
        ]
      : []),
    ...project.acceptedMembers
  ];
  const projectAssignee = projectMembers.find(
    (member) => (member.firebaseUid || member.firebase_uid) === task.assigneeFirebaseUid
  );
  const taskAssignee: ProjectMember[] = task.assigneeFirebaseUid
    ? [
        {
          ...projectAssignee,
          firebaseUid: task.assigneeFirebaseUid,
          name: task.assigneeName || projectAssignee?.name || 'Project member',
          profileImage:
            task.assigneeProfileImage ||
            projectAssignee?.profileImage ||
            projectAssignee?.profile_image
        }
      ]
    : [];
  return {
    ...task,
    assignees:
      taskAssignee.length > 0
        ? taskAssignee
        : sprintMembers.length > 0
          ? sprintMembers
          : task.sprintMembers || []
  };
}

function toBoardStatus(status?: string): BoardColumnStatus {
  const normalized = String(status || '').trim().toLowerCase();
  if (normalized === 'to do' || normalized === 'todo') return 'To do';
  if (normalized === 'in progress') return 'In Progress';
  if (normalized === 'done') return 'Done';
  if (normalized === 'launched') return 'Launched';
  return 'Pending';
}

function toBoardPriority(priority?: string): TaskItem['priority'] {
  const normalized = String(priority || '').toLowerCase();
  if (
    normalized === 'none' ||
    normalized === 'low' ||
    normalized === 'medium' ||
    normalized === 'high' ||
    normalized === 'urgent'
  ) {
    return normalized;
  }
  return 'medium';
}

function normalizeTaskComment(raw: Record<string, unknown>, idx: number): TaskComment {
  const id = String(raw.comment_id || raw.id || `comment-${idx}`);
  const authorName = String(
    raw.author_name || raw.authorName || raw.author || raw.author_email || 'Teammate'
  );
  const text = String(raw.body ?? raw.text ?? '');
  const createdAt = String(raw.created_at || raw.createdAt || '');
  return {
    id,
    commentId: raw.comment_id ? String(raw.comment_id) : id,
    author: authorName,
    authorName,
    author_name: authorName,
    authorEmail: raw.author_email ? String(raw.author_email) : undefined,
    authorUid: raw.author_firebase_uid ? String(raw.author_firebase_uid) : undefined,
    authorProfileImage: raw.author_profile_image ? String(raw.author_profile_image) : undefined,
    text,
    body: text,
    createdAt,
    created_at: createdAt,
    attachments: Array.isArray(raw.attachments) ? (raw.attachments as TaskComment['attachments']) : []
  };
}

export const ProjectBoard: React.FC = () => {
  const {
    activeProject,
    isCurrentUserProjectCreator,
    projects,
    loadProjectSprints,
    accessibleTasks,
    switchView,
    selectedTaskViewId,
    openFullTaskView,
    closeFullTaskView,
    selectedSprintView,
    openTaskDetails,
    moveTaskStatus,
    setActiveModal,
    setTasks,
    showDashboardToast
  } = useDashboard();

  const project = activeProject;
  const taskDrawerRef = useRef<HTMLElement | null>(null);
  const [sprintTasks, setSprintTasks] = useState<OverviewTask[]>([]);
  const [sprintTasksLoading, setSprintTasksLoading] = useState(false);
  const [sprintTasksError, setSprintTasksError] = useState('');
  const [sprintTasksRetryCount, setSprintTasksRetryCount] = useState(0);

  useEffect(() => {
    if (!project?.projectId) return;

    let cancelled = false;
    loadProjectSprints(project.projectId)
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error('Unable to fetch project sprints for the project view:', error);
      });

    return () => {
      cancelled = true;
    };
  }, [project?.projectId, loadProjectSprints]);

  const tasks = useMemo(() => {
    if (!project) return [];
    return accessibleTasks
      .filter(
        (task) =>
          task.projectId === project.projectId ||
          task.project_id === project.projectId ||
          task.project === project.name
      )
      .map((task) => getOverviewTask(task, project));
  }, [accessibleTasks, project]);

  const allTasks = useMemo(
    () =>
      accessibleTasks.map((task) => {
        const taskProject = projects.find(
          (item) =>
            item.projectId === task.projectId ||
            item.projectId === task.project_id ||
            item.name === task.project
        );
        return taskProject ? getOverviewTask(task, taskProject) : { ...task, assignees: [] };
      }),
    [accessibleTasks, projects]
  );

  useEffect(() => {
    if (
      !project?.projectId ||
      !selectedSprintView ||
      selectedSprintView.projectId !== project.projectId
    ) {
      setSprintTasks([]);
      setSprintTasksLoading(false);
      setSprintTasksError('');
      return;
    }

    const selectedSprint = selectedSprintView.sprint;
    const selectedSprintId = String(selectedSprint.id || selectedSprint.sprintId || '');
    let cancelled = false;
    setSprintTasksLoading(true);
    setSprintTasksError('');

    if (!selectedSprintId) {
      setSprintTasks([]);
      setSprintTasksLoading(false);
      setSprintTasksError('This sprint does not have an ID, so its tasks cannot be loaded.');
      return;
    }

    api
      .get(
        `/projects/${encodeURIComponent(project.projectId)}/tasks?sprintId=${encodeURIComponent(selectedSprintId)}`
      )
      .then((response) => {
        if (cancelled) return;
        const rawTasks = response?.data?.tasks;
        if (!Array.isArray(rawTasks)) {
          throw new Error('The server returned an invalid project tasks response.');
        }
        const fetchedSprintTasks = rawTasks
          .map((task: TaskItem) => normalizeTaskRecord(task, project))
          .filter(
            (task: TaskItem) =>
              String(task.sprintId || task.sprint_id || '') === selectedSprintId
          );
        const loadedSprintTasks =
          fetchedSprintTasks.length > 0
            ? fetchedSprintTasks
            : tasks.filter(
                (task) =>
                  (task.projectId === project.projectId ||
                    task.project_id === project.projectId) &&
                  String(task.sprintId || task.sprint_id || '') === selectedSprintId
              );
        setSprintTasks(loadedSprintTasks.map((task) => getOverviewTask(task, project)));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : 'Sprint tasks could not be loaded.';
        console.error('Unable to fetch tasks for the selected sprint:', error);
        setSprintTasksError(message);
      })
      .finally(() => {
        if (!cancelled) setSprintTasksLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    project,
    tasks,
    selectedSprintView,
    accessibleTasks,
    sprintTasksRetryCount
  ]);

  const selectedTaskBase = useMemo(() => {
    if (selectedTaskViewId === null) return null;
    const target = String(selectedTaskViewId);
    return (
      tasks.find(
        (t) =>
          String(t.id) === target ||
          String(t.taskId || '') === target ||
          String(t.task_id || '') === target
      ) ||
      allTasks.find(
        (t) =>
          String(t.id) === target ||
          String(t.taskId || '') === target ||
          String(t.task_id || '') === target
      ) ||
      null
    );
  }, [selectedTaskViewId, tasks, allTasks]);

  const selectedTaskProject = useMemo(() => {
    if (!selectedTaskBase) return project || null;
    return (
      projects.find(
        (item) =>
          item.projectId === selectedTaskBase.projectId ||
          item.projectId === selectedTaskBase.project_id ||
          item.name === selectedTaskBase.project
      ) ||
      project ||
      null
    );
  }, [selectedTaskBase, projects, project]);

  const [fetchedTask, setFetchedTask] = useState<OverviewTask | null>(null);
  const [taskComments, setTaskComments] = useState<TaskComment[]>([]);
  const [taskLoading, setTaskLoading] = useState<boolean>(false);
  const [taskError, setTaskError] = useState<string>('');
  const [retryCounter, setRetryCounter] = useState<number>(0);
  const [subtasksByTask, setSubtasksByTask] = useState<Record<string, TaskSubtask[]>>({});

  useEffect(() => {
    if (selectedTaskViewId === null) return;

    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    taskDrawerRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeFullTaskView();
        return;
      }
      if (event.key !== 'Tab') return;

      const focusableElements = taskDrawerRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusableElements?.length) {
        event.preventDefault();
        taskDrawerRef.current?.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      if (!firstElement || !lastElement) return;
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus?.focus();
    };
  }, [selectedTaskViewId, closeFullTaskView]);

  useEffect(() => {
    if (selectedTaskViewId === null || !selectedTaskProject?.projectId) {
      setFetchedTask(null);
      setTaskComments([]);
      setTaskLoading(false);
      setTaskError('');
      return;
    }

    const projectId = selectedTaskProject.projectId;
    const taskId = String(
      selectedTaskBase?.taskId || selectedTaskBase?.task_id || selectedTaskViewId
    );
    let cancelled = false;

    setTaskLoading(!selectedTaskBase);
    setTaskError('');

    Promise.all([
      api.get(
        `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}?metadataOnly=true`
      ),
      api.get(
        `/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/comments`
      )
    ])
      .then(([taskRes, commentsRes]) => {
        if (cancelled) return;
        const rawTask = taskRes?.data?.task;
        if (rawTask) {
          const normalized = normalizeTaskRecord(rawTask, selectedTaskProject);
          setFetchedTask(getOverviewTask(normalized, selectedTaskProject));
        }
        const rawComments = Array.isArray(commentsRes?.data?.comments)
          ? commentsRes.data.comments
          : [];
        setTaskComments(rawComments.map(normalizeTaskComment));
        setTaskError('');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message =
          err instanceof Error ? err.message : 'Unable to load task details right now.';
        setTaskError(message);
      })
      .finally(() => {
        if (!cancelled) setTaskLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedTaskViewId, selectedTaskProject, selectedTaskBase?.taskId, selectedTaskBase?.task_id, retryCounter]);

  const activeViewerTask: ViewerTaskItem | null = useMemo(() => {
    const source = fetchedTask || selectedTaskBase;
    if (!source) return null;

    const projectTasks = selectedTaskProject
      ? allTasks.filter(
          (item) =>
            item.projectId === selectedTaskProject.projectId ||
            item.project_id === selectedTaskProject.projectId ||
            item.project === selectedTaskProject.name
        )
      : tasks;

    const todayKey = new Date().toISOString().slice(0, 10);
    const boardItems: BoardCardItem[] = projectTasks.map((item) => {
      const dueDateKey = item.date || item.due_date || undefined;
      return {
        id: String(item.taskId || item.id),
        title: item.title,
        status: toBoardStatus(item.status),
        assignees: item.assignees || [],
        due: item.due && item.due !== '—' ? item.due : undefined,
        dueDateKey: dueDateKey || undefined,
        priority: toBoardPriority(item.priority),
        progress: item.progress,
        overdue: Boolean(dueDateKey && dueDateKey < todayKey && item.status !== 'Done')
      };
    });

    const key = String(source.taskId || source.id);
    return {
      ...source,
      subtasks: subtasksByTask[key] || [],
      boardItems
    };
  }, [fetchedTask, selectedTaskBase, selectedTaskProject, allTasks, tasks, subtasksByTask]);

  const handleAddComment = useCallback(
    async (taskId: string | number, text: string) => {
      if (!selectedTaskProject?.projectId) return;
      const tid = String(selectedTaskBase?.taskId || selectedTaskBase?.task_id || taskId);
      try {
        const res = await api.post(
          `/projects/${encodeURIComponent(selectedTaskProject.projectId)}/tasks/${encodeURIComponent(tid)}/comments`,
          { text, attachments: [] }
        );
        const created = res?.data?.comment;
        if (created) {
          setTaskComments((prev) => [...prev, normalizeTaskComment(created, prev.length)]);
          setTasks((prev) =>
            prev.map((item) =>
              String(item.id) === String(taskId) || String(item.taskId || '') === tid
                ? { ...item, comments: (item.comments || 0) + 1 }
                : item
            )
          );
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unable to post comment.';
        showDashboardToast(message, 'error');
      }
    },
    [selectedTaskProject, selectedTaskBase, setTasks, showDashboardToast]
  );

  const handleToggleSubtask = useCallback(
    (taskId: string | number, subtaskId: string) => {
      const key = String(selectedTaskBase?.taskId || taskId);
      setSubtasksByTask((prev) => {
        const existing = prev[key] || [];
        return {
          ...prev,
          [key]: existing.map((sub) =>
            sub.id === subtaskId ? { ...sub, done: !sub.done } : sub
          )
        };
      });
    },
    [selectedTaskBase]
  );

  const handleUploadAttachment = useCallback(
    (_taskId: string | number, uploaded: TaskAttachment[]) => {
      if (uploaded.length > 0) {
        showDashboardToast(
          `${uploaded.length} file${uploaded.length === 1 ? '' : 's'} attached to this task view.`,
          'success'
        );
      }
    },
    [showDashboardToast]
  );

  const taskDrawer = project && selectedTaskViewId !== null ? (
    <div
      className={drawerStyles.overlay}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeFullTaskView();
      }}
    >
      <aside
        ref={taskDrawerRef}
        className={drawerStyles.panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby="task-drawer-title"
        tabIndex={-1}
      >
        <header className={drawerStyles.header}>
          <div className={drawerStyles['title-wrap']}>
            <span className={drawerStyles['project-name']}>
              {selectedTaskProject?.name || project.name}
            </span>
            <h2 id="task-drawer-title" className={drawerStyles.title}>
              {activeViewerTask?.title || 'Task details'}
            </h2>
          </div>
          <button
            type="button"
            className={drawerStyles['close-button']}
            aria-label="Close task details"
            onClick={closeFullTaskView}
          >
            <X size={17} />
          </button>
        </header>
        <div className={drawerStyles.content}>
          <TaskDetails
            task={activeViewerTask}
            project={selectedTaskProject}
            comments={taskComments}
            loading={taskLoading}
            error={taskError}
            onRetry={() => setRetryCounter((n) => n + 1)}
            asideMode
            isProjectOwner={isCurrentUserProjectCreator}
            onOpenAnalysis={() => {
              if (activeViewerTask) openTaskDetails(activeViewerTask.id);
            }}
            onAddTask={() => {
              setActiveModal({
                type: 'createTask',
                projectId: selectedTaskProject?.projectId || project.projectId
              });
            }}
            onAssignTeamMember={
              isCurrentUserProjectCreator
                ? () => {
                    const sprintId = activeViewerTask?.sprintId || activeViewerTask?.sprint_id;
                    if (!selectedTaskProject?.projectId || !sprintId) {
                      showDashboardToast('This task is not linked to a sprint.', 'error');
                      return;
                    }
                    setActiveModal({
                      type: 'assignSprintTask',
                      projectId: selectedTaskProject.projectId,
                      sprintId: String(sprintId)
                    });
                  }
                : undefined
            }
            onAddComment={(taskId, text) => {
              void handleAddComment(taskId, text);
            }}
            onToggleSubtask={handleToggleSubtask}
            onUploadAttachment={handleUploadAttachment}
          />
        </div>
      </aside>
    </div>
  ) : null;

  if (selectedSprintView && selectedSprintView.projectId === project?.projectId && project) {
    const sprint = selectedSprintView.sprint;
    const sprintId = sprint.id || sprint.sprintId || '';
    const sprintEndDate =
      sprint.dueDate || sprint.due_date || sprint.endDate || sprint.end_date || null;
    const status = ['Backlog', 'To do', 'In progress', 'Blocked', 'Done'].includes(
      sprint.status || ''
    )
      ? (sprint.status as TaskItem['status'])
      : 'To do';
    const sprintTask: ViewerTaskItem = {
      id: `sprint-${sprint.id || sprint.sprintId || sprint.name}`,
      projectId: project.projectId,
      project_id: project.projectId,
      project: project.name,
      sprintId: String(sprintId),
      sprint_id: String(sprintId),
      title: sprint.name,
      description: sprint.description || '',
      tag: 'Sprint',
      category: 'Sprint',
      tags: [],
      due: sprintEndDate ? String(sprintEndDate) : '—',
      date: sprintEndDate ? String(sprintEndDate) : null,
      startDate: sprint.startDate || sprint.start_date || null,
      status,
      priority: 'medium',
      progress: 0,
      sprint: sprint.name,
      subtasks: sprintTasks.map((task) => ({
        id: String(task.id),
        title: task.title,
        done: task.status === 'Done',
        due: task.due,
        assignees: task.assignees || task.sprintMembers || []
      })),
      boardItems: sprintTasks.map((task) => ({
        id: String(task.id),
        title: task.title,
        status: toBoardStatus(task.status),
        assignees: task.assignees || task.sprintMembers || [],
        due: task.due === '—' ? undefined : task.due,
        dueDateKey: task.date || undefined,
        priority: toBoardPriority(task.priority)
      })),
      descriptionAttachments: [
        ...(sprint.attachments || []),
        ...sprintTasks.flatMap((task) => [
          ...(task.descriptionAttachments || []),
          ...(task.taskSubmissionAttachments || [])
        ])
      ],
      comments: 0,
      commentsList: []
    };

    return (
      <>
        <TaskDetails
          task={sprintTask}
          project={project}
          loading={sprintTasksLoading}
          error={sprintTasksError}
          onRetry={() => setSprintTasksRetryCount((count) => count + 1)}
          isProjectOwner={true}
          onOpenAnalysis={() => openTaskDetails(sprintTask.id)}
          onOpenBoardTask={(taskId) => openFullTaskView(taskId, project.name, true)}
          onAddTask={() => {
            setActiveModal({
              type: 'createTask',
              projectId: project.projectId,
              sprintId: String(sprintId)
            });
          }}
          onAssignTeamMember={
            isCurrentUserProjectCreator
              ? () => {
                  setActiveModal({
                    type: 'assignSprintTask',
                    projectId: project.projectId,
                    sprintId: String(sprintId)
                  });
                }
              : undefined
          }
        />
        {taskDrawer}
      </>
    );
  }

  if (!project) {
    return (
      <div role="status" style={{ padding: 24 }}>
        No project is available to display.
      </div>
    );
  }

  return (
    <>
      <ProjectOverview
        project={project}
        allProjects={projects}
        tasks={tasks}
        allTasks={allTasks}
        canViewTaskMetrics={isCurrentUserProjectCreator}
        onSelectProject={(projectId) => {
          const selected = projects.find((item) => item.projectId === projectId);
          if (selected) switchView(selected.name);
        }}
        onOpenProgressAside={(taskId) => openFullTaskView(taskId, project.name)}
        onToggleTaskDone={(taskId) => {
          const task = tasks.find((item) => String(item.id) === String(taskId));
          if (task) {
            void moveTaskStatus(taskId, task.status === 'Done' ? 'To do' : 'Done');
          }
        }}
        onCreateSprint={(projectId) =>
          setActiveModal({
            type: 'addSprint',
            projectId
          })
        }
        onInviteMembers={(projectId) =>
          setActiveModal({
            type: 'inviteCollaborator',
            projectId
          })
        }
      />
      {taskDrawer}
    </>
  );
};
