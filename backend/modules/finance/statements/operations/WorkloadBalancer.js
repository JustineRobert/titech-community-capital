'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * WorkloadBalancer
 * ============================================================================
 *
 * Purpose
 * -------
 * Enterprise workload allocation and balancing engine for statement
 * intelligence / repair operations.
 *
 * Responsibilities
 * ----------------
 * - Normalize operational workload
 * - Measure team/member capacity
 * - Calculate workload pressure
 * - Detect overload / under-utilization
 * - Allocate work using deterministic balancing rules
 * - Rebalance existing assignments
 * - Respect skills, availability, priority and workload limits
 * - Prevent unsafe assignments
 * - Produce operational recommendations
 * - Generate workload forecasts
 * - Support dry-run planning
 * - Support idempotent planning
 * - Produce audit-friendly decision metadata
 *
 * Architectural Position
 * ----------------------
 *
 * Statement Processing
 *        ↓
 * Statement Reconciliation
 *        ↓
 * Statement Repair
 *        ↓
 * Repair Analytics / Forecasting
 *        ↓
 * Branch / Team Performance
 *        ↓
 * WorkloadBalancer
 *        ↓
 * Operational Assignment / Scheduler
 *
 * Design Principles
 * -----------------
 * - No direct HTTP/controller concerns
 * - No direct database coupling
 * - Dependency injection
 * - Deterministic decisions
 * - Safe defaults
 * - Tenant isolation
 * - Immutable decision snapshots
 * - No mutation of caller-owned objects
 * - Explicit confidence / rationale
 * - Graceful degradation
 * - Idempotency support
 * - Structured observability hooks
 *
 * Integration
 * -----------
 * The service intentionally accepts repositories, metrics providers,
 * availability providers and logger/telemetry implementations through
 * constructor dependency injection.
 *
 * It therefore works with the existing architecture without forcing a new
 * persistence layer or folder structure.
 *
 * ============================================================================
 */

const DEFAULTS = Object.freeze({
    maxUtilization: 0.85,
    criticalUtilization: 0.95,
    minimumUtilization: 0.20,

    defaultDailyCapacity: 8,
    defaultTaskDurationMinutes: 30,

    highPriorityWeight: 5,
    mediumPriorityWeight: 3,
    lowPriorityWeight: 1,

    urgencyWeight: 0.30,
    capacityWeight: 0.30,
    skillWeight: 0.20,
    priorityWeight: 0.15,
    continuityWeight: 0.05,

    rebalanceThreshold: 0.15,

    maximumAssignmentsPerPlan: 1000,

    planningHorizonDays: 7,

    minimumConfidence: 0.50,

    staleWorkloadMinutes: 30,

    maxConsecutiveFailures: 3,

    maxTaskDurationMinutes: 24 * 60,

    defaultTimezone: 'UTC'
});

const WORKLOAD_STATUS = Object.freeze({
    EMPTY: 'EMPTY',
    LOW: 'LOW',
    BALANCED: 'BALANCED',
    HIGH: 'HIGH',
    CRITICAL: 'CRITICAL',
    UNAVAILABLE: 'UNAVAILABLE'
});

const ASSIGNMENT_STATUS = Object.freeze({
    PROPOSED: 'PROPOSED',
    ASSIGNED: 'ASSIGNED',
    DEFERRED: 'DEFERRED',
    BLOCKED: 'BLOCKED',
    REBALANCED: 'REBALANCED'
});

const PLAN_STATUS = Object.freeze({
    PLANNED: 'PLANNED',
    PARTIAL: 'PARTIAL',
    BLOCKED: 'BLOCKED',
    EMPTY: 'EMPTY'
});

const PRIORITY_WEIGHT = Object.freeze({
    CRITICAL: 10,
    HIGH: 5,
    MEDIUM: 3,
    LOW: 1
});

const DEFAULT_SKILLS = Object.freeze([
    'GENERAL_STATEMENT_OPERATIONS'
]);

/**
 * --------------------------------------------------------------------------
 * Utility helpers
 * --------------------------------------------------------------------------
 */

function isObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNumber(value) {
    return Number.isFinite(Number(value));
}

function toNumber(value, fallback = 0) {
    const number = Number(value);

    return Number.isFinite(number)
        ? number
        : fallback;
}

function clamp(value, min = 0, max = 1) {
    return Math.min(max, Math.max(min, toNumber(value, min)));
}

function round(value, decimals = 4) {
    const factor = Math.pow(10, decimals);

    return Math.round(toNumber(value) * factor) / factor;
}

function safeArray(value) {
    return Array.isArray(value) ? value : [];
}

function normalizeString(value, fallback = '') {
    if (value === null || value === undefined) {
        return fallback;
    }

    return String(value).trim();
}

function normalizeId(value) {
    return normalizeString(value);
}

function normalizePriority(priority) {
    const value = normalizeString(priority, 'MEDIUM').toUpperCase();

    if (PRIORITY_WEIGHT[value]) {
        return value;
    }

    return 'MEDIUM';
}

function priorityWeight(priority) {
    return PRIORITY_WEIGHT[normalizePriority(priority)] || 3;
}

function parseDate(value, fallback = null) {
    if (!value) {
        return fallback;
    }

    const date = value instanceof Date
        ? new Date(value.getTime())
        : new Date(value);

    return Number.isNaN(date.getTime())
        ? fallback
        : date;
}

function clone(value) {
    if (value === undefined || value === null) {
        return value;
    }

    if (typeof structuredClone === 'function') {
        try {
            return structuredClone(value);
        } catch (error) {
            // Fall through to JSON-safe cloning.
        }
    }

    try {
        return JSON.parse(JSON.stringify(value));
    } catch (error) {
        return value;
    }
}

function intersection(left, right) {
    const rightSet = new Set(
        safeArray(right)
            .map(item => normalizeString(item).toUpperCase())
            .filter(Boolean)
    );

    return safeArray(left)
        .map(item => normalizeString(item).toUpperCase())
        .filter(item => item && rightSet.has(item));
}

function unique(values) {
    return [...new Set(
        safeArray(values)
            .map(value => normalizeString(value))
            .filter(Boolean)
    )];
}

function now() {
    return new Date();
}

function generateId(prefix = 'WB') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeSkills(value) {
    return unique(
        safeArray(value)
            .concat(
                typeof value === 'string'
                    ? value.split(',')
                    : []
            )
            .map(skill => skill.toUpperCase())
    );
}

function minutesBetween(start, end) {
    const startDate = parseDate(start);
    const endDate = parseDate(end);

    if (!startDate || !endDate) {
        return 0;
    }

    return Math.max(
        0,
        Math.round((endDate.getTime() - startDate.getTime()) / 60000)
    );
}

function stableSort(items, comparator) {
    return [...items].sort(comparator);
}

/**
 * ============================================================================
 * WorkloadBalancer
 * ============================================================================
 */

class WorkloadBalancer {

    /**
     * @param {Object} [dependencies]
     * @param {Object} [dependencies.repository]
     * @param {Object} [dependencies.assignmentRepository]
     * @param {Object} [dependencies.capacityProvider]
     * @param {Object} [dependencies.availabilityProvider]
     * @param {Object} [dependencies.metrics]
     * @param {Object} [dependencies.logger]
     * @param {Object} [dependencies.telemetry]
     * @param {Object} [dependencies.clock]
     * @param {Object} [dependencies.config]
     */
    constructor(dependencies = {}) {

        if (!isObject(dependencies)) {
            throw new TypeError(
                'WorkloadBalancer dependencies must be an object.'
            );
        }

        this.repository = dependencies.repository || null;

        this.assignmentRepository =
            dependencies.assignmentRepository || null;

        this.capacityProvider =
            dependencies.capacityProvider || null;

        this.availabilityProvider =
            dependencies.availabilityProvider || null;

        this.metrics =
            dependencies.metrics || null;

        this.logger =
            dependencies.logger || null;

        this.telemetry =
            dependencies.telemetry || null;

        this.clock =
            dependencies.clock || {
                now
            };

        this.config = Object.freeze({
            ...DEFAULTS,
            ...(isObject(dependencies.config)
                ? dependencies.config
                : {})
        });

        this._validateConfiguration();
    }

    /**
     * =========================================================================
     * Public API
     * =========================================================================
     */

    /**
     * Analyze workload distribution.
     *
     * @param {Object} input
     * @returns {Promise<Object>}
     */
    async analyze(input = {}) {

        const context = this._createContext(input, 'analyze');

        return this._withTelemetry(
            'workload.analyze',
            context,
            async () => {

                const members = this._normalizeMembers(
                    input.members || []
                );

                const tasks = this._normalizeTasks(
                    input.tasks || input.workload || []
                );

                const assignments =
                    this._normalizeAssignments(
                        input.assignments || []
                    );

                const memberSnapshots = members.map(member =>
                    this._buildMemberWorkloadSnapshot(
                        member,
                        tasks,
                        assignments,
                        context
                    )
                );

                const summary =
                    this._buildWorkloadSummary(memberSnapshots, tasks);

                const imbalance =
                    this._calculateImbalance(memberSnapshots);

                const recommendations =
                    this._generateBalancingRecommendations(
                        memberSnapshots,
                        tasks,
                        context
                    );

                const result = {
                    operation: 'analyze',
                    ...context.metadata,

                    summary,
                    imbalance,
                    members: memberSnapshots,
                    recommendations,

                    generatedAt: this._now().toISOString()
                };

                this._recordMetric(
                    'workload_analysis_completed',
                    1,
                    {
                        tenantId: context.tenantId
                    }
                );

                return result;
            }
        );
    }

    /**
     * Build an assignment plan.
     *
     * @param {Object} input
     * @returns {Promise<Object>}
     */
    async plan(input = {}) {

        const context = this._createContext(input, 'plan');

        return this._withTelemetry(
            'workload.plan',
            context,
            async () => {

                const members = this._normalizeMembers(
                    input.members || []
                );

                const tasks = this._normalizeTasks(
                    input.tasks || input.workload || []
                );

                const existingAssignments =
                    this._normalizeAssignments(
                        input.assignments || []
                    );

                if (!members.length || !tasks.length) {
                    return this._emptyPlan(context);
                }

                const planId =
                    normalizeId(input.planId) || generateId('WBP');

                const allocation =
                    this._allocateTasks({
                        members,
                        tasks,
                        assignments: existingAssignments,
                        context
                    });

                const status =
                    this._determinePlanStatus(
                        allocation.assignments,
                        tasks
                    );

                const plan = {
                    planId,
                    operation: 'plan',

                    ...context.metadata,

                    status,

                    assignments: allocation.assignments,

                    deferredTasks: allocation.deferredTasks,

                    blockedTasks: allocation.blockedTasks,

                    utilization:
                        this._buildPlanUtilization(
                            members,
                            allocation.assignments,
                            existingAssignments
                        ),

                    rationale: allocation.rationale,

                    confidence:
                        this._calculatePlanConfidence(
                            allocation,
                            members
                        ),

                    createdAt: this._now().toISOString()
                };

                await this._persistPlan(plan, context);

                this._recordMetric(
                    'workload_plan_created',
                    1,
                    {
                        tenantId: context.tenantId,
                        status
                    }
                );

                return plan;
            }
        );
    }

    /**
     * Rebalance an existing workload.
     *
     * @param {Object} input
     * @returns {Promise<Object>}
     */
    async rebalance(input = {}) {

        const context = this._createContext(
            input,
            'rebalance'
        );

        return this._withTelemetry(
            'workload.rebalance',
            context,
            async () => {

                const members = this._normalizeMembers(
                    input.members || []
                );

                const tasks = this._normalizeTasks(
                    input.tasks || []
                );

                const assignments =
                    this._normalizeAssignments(
                        input.assignments || []
                    );

                if (!members.length || !assignments.length) {
                    return {
                        operation: 'rebalance',
                        ...context.metadata,
                        status: PLAN_STATUS.EMPTY,
                        changes: [],
                        unchanged: assignments,
                        confidence: 1,
                        generatedAt: this._now().toISOString()
                    };
                }

                const currentSnapshots =
                    members.map(member =>
                        this._buildMemberWorkloadSnapshot(
                            member,
                            tasks,
                            assignments,
                            context
                        )
                    );

                const changes = [];

                const candidateAssignments =
                    assignments.map(assignment => clone(assignment));

                const overloadedMembers =
                    currentSnapshots
                        .filter(snapshot =>
                            snapshot.status === WORKLOAD_STATUS.HIGH ||
                            snapshot.status === WORKLOAD_STATUS.CRITICAL
                        )
                        .sort(
                            (a, b) =>
                                b.utilization -
                                a.utilization
                        );

                for (const overloaded of overloadedMembers) {

                    const movable =
                        this._findMovableAssignments(
                            overloaded.memberId,
                            candidateAssignments,
                            tasks
                        );

                    for (const assignment of movable) {

                        const target =
                            this._findBestRebalanceTarget({
                                assignment,
                                overloadedMemberId:
                                    overloaded.memberId,
                                members,
                                tasks,
                                assignments:
                                    candidateAssignments,
                                context
                            });

                        if (!target) {
                            continue;
                        }

                        const index =
                            candidateAssignments.findIndex(
                                item =>
                                    normalizeId(item.assignmentId) ===
                                    normalizeId(assignment.assignmentId)
                            );

                        if (index < 0) {
                            continue;
                        }

                        const previousMemberId =
                            candidateAssignments[index].memberId;

                        candidateAssignments[index] = {
                            ...candidateAssignments[index],

                            memberId: target.memberId,

                            status:
                                ASSIGNMENT_STATUS.REBALANCED,

                            rebalancedAt:
                                this._now().toISOString(),

                            rebalanceReason:
                                target.reason
                        };

                        changes.push({
                            assignmentId:
                                assignment.assignmentId,

                            fromMemberId:
                                previousMemberId,

                            toMemberId:
                                target.memberId,

                            score:
                                target.score,

                            reason:
                                target.reason
                        });
                    }
                }

                const afterSnapshots =
                    members.map(member =>
                        this._buildMemberWorkloadSnapshot(
                            member,
                            tasks,
                            candidateAssignments,
                            context
                        )
                    );

                const improved =
                    this._calculateAverageUtilizationPressure(
                        afterSnapshots
                    ) <=
                    this._calculateAverageUtilizationPressure(
                        currentSnapshots
                    );

                const result = {
                    operation: 'rebalance',
                    ...context.metadata,

                    status: changes.length
                        ? PLAN_STATUS.PLANNED
                        : PLAN_STATUS.EMPTY,

                    changes,

                    assignments:
                        candidateAssignments,

                    before:
                        this._buildWorkloadSummary(
                            currentSnapshots,
                            tasks
                        ),

                    after:
                        this._buildWorkloadSummary(
                            afterSnapshots,
                            tasks
                        ),

                    improved,

                    confidence:
                        this._calculateRebalanceConfidence(
                            changes,
                            improved
                        ),

                    generatedAt:
                        this._now().toISOString()
                };

                await this._persistRebalance(
                    result,
                    context
                );

                this._recordMetric(
                    'workload_rebalance_completed',
                    1,
                    {
                        tenantId: context.tenantId,
                        changes: String(changes.length)
                    }
                );

                return result;
            }
        );
    }

    /**
     * Allocate a single task.
     *
     * @param {Object} input
     * @returns {Promise<Object>}
     */
    async allocate(input = {}) {

        const context = this._createContext(
            input,
            'allocate'
        );

        return this._withTelemetry(
            'workload.allocate',
            context,
            async () => {

                const task =
                    this._normalizeTask(
                        input.task || input
                    );

                const members =
                    this._normalizeMembers(
                        input.members || []
                    );

                const assignments =
                    this._normalizeAssignments(
                        input.assignments || []
                    );

                if (!task.taskId) {
                    throw this._error(
                        'TASK_ID_REQUIRED',
                        'A taskId is required for workload allocation.'
                    );
                }

                const ranked =
                    this._rankCandidates({
                        task,
                        members,
                        assignments,
                        tasks: [task],
                        context
                    });

                const candidate = ranked[0] || null;

                if (!candidate) {

                    return {
                        operation: 'allocate',
                        ...context.metadata,

                        status:
                            ASSIGNMENT_STATUS.BLOCKED,

                        taskId: task.taskId,

                        assignment: null,

                        candidates: ranked,

                        reason:
                            'No eligible operational resource is available.',

                        confidence: 0,

                        generatedAt:
                            this._now().toISOString()
                    };
                }

                const assignment =
                    this._createAssignment(
                        task,
                        candidate,
                        context
                    );

                return {
                    operation: 'allocate',
                    ...context.metadata,

                    status:
                        ASSIGNMENT_STATUS.PROPOSED,

                    taskId:
                        task.taskId,

                    assignment,

                    candidates:
                        ranked,

                    confidence:
                        candidate.score,

                    generatedAt:
                        this._now().toISOString()
                };
            }
        );
    }

    /**
     * Calculate capacity for a member.
     *
     * @param {Object} input
     * @returns {Promise<Object>}
     */
    async calculateCapacity(input = {}) {

        const context = this._createContext(
            input,
            'calculateCapacity'
        );

        return this._withTelemetry(
            'workload.capacity',
            context,
            async () => {

                const member =
                    this._normalizeMember(
                        input.member || input
                    );

                const assignments =
                    this._normalizeAssignments(
                        input.assignments || []
                    );

                const date =
                    parseDate(
                        input.date,
                        this._now()
                    );

                const snapshot =
                    this._buildMemberWorkloadSnapshot(
                        member,
                        [],
                        assignments,
                        context,
                        date
                    );

                return {
                    operation:
                        'calculateCapacity',

                    ...context.metadata,

                    memberId:
                        member.memberId,

                    date:
                        date.toISOString(),

                    capacityMinutes:
                        snapshot.capacityMinutes,

                    allocatedMinutes:
                        snapshot.allocatedMinutes,

                    availableMinutes:
                        snapshot.availableMinutes,

                    utilization:
                        snapshot.utilization,

                    status:
                        snapshot.status,

                    generatedAt:
                        this._now().toISOString()
                };
            }
        );
    }

    /**
     * Forecast workload.
     *
     * @param {Object} input
     * @returns {Promise<Object>}
     */
    async forecast(input = {}) {

        const context = this._createContext(
            input,
            'forecast'
        );

        return this._withTelemetry(
            'workload.forecast',
            context,
            async () => {

                const members =
                    this._normalizeMembers(
                        input.members || []
                    );

                const tasks =
                    this._normalizeTasks(
                        input.tasks || []
                    );

                const assignments =
                    this._normalizeAssignments(
                        input.assignments || []
                    );

                const horizonDays =
                    Math.max(
                        1,
                        Math.min(
                            365,
                            Math.floor(
                                toNumber(
                                    input.horizonDays,
                                    this.config.planningHorizonDays
                                )
                            )
                        )
                    );

                const startDate =
                    parseDate(
                        input.startDate,
                        this._now()
                    );

                const days = [];

                for (let index = 0; index < horizonDays; index++) {

                    const date = new Date(
                        startDate.getTime()
                    );

                    date.setUTCDate(
                        date.getUTCDate() + index
                    );

                    const dayTasks =
                        tasks.filter(
                            task =>
                                this._taskRelevantOnDate(
                                    task,
                                    date
                                )
                        );

                    const dayAssignments =
                        assignments.filter(
                            assignment =>
                                this._assignmentRelevantOnDate(
                                    assignment,
                                    date
                                )
                        );

                    const snapshots =
                        members.map(member =>
                            this._buildMemberWorkloadSnapshot(
                                member,
                                dayTasks,
                                dayAssignments,
                                context,
                                date
                            )
                        );

                    days.push({
                        date:
                            date.toISOString().slice(0, 10),

                        summary:
                            this._buildWorkloadSummary(
                                snapshots,
                                dayTasks
                            ),

                        members:
                            snapshots
                    });
                }

                const pressure =
                    this._calculateForecastPressure(days);

                return {
                    operation: 'forecast',
                    ...context.metadata,

                    horizonDays,

                    startDate:
                        startDate.toISOString(),

                    days,

                    pressure,

                    recommendations:
                        this._generateForecastRecommendations(
                            days
                        ),

                    generatedAt:
                        this._now().toISOString()
                };
            }
        );
    }

    /**
     * Return workload recommendations.
     *
     * @param {Object} input
     * @returns {Promise<Array>}
     */
    async recommend(input = {}) {

        const context = this._createContext(
            input,
            'recommend'
        );

        const analysis =
            await this.analyze({
                ...input,

                tenantId:
                    context.tenantId,

                requestId:
                    context.requestId
            });

        return {
            operation: 'recommend',

            ...context.metadata,

            recommendations:
                analysis.recommendations,

            generatedAt:
                this._now().toISOString()
        };
    }

    /**
     * Check whether a proposed assignment is safe.
     *
     * @param {Object} input
     * @returns {Promise<Object>}
     */
    async validateAssignment(input = {}) {

        const context = this._createContext(
            input,
            'validateAssignment'
        );

        const task =
            this._normalizeTask(
                input.task || {}
            );

        const member =
            this._normalizeMember(
                input.member || {}
            );

        const assignments =
            this._normalizeAssignments(
                input.assignments || []
            );

        const validation =
            this._validateCandidate(
                task,
                member,
                assignments,
                input.tasks || [],
                context
            );

        return {
            operation:
                'validateAssignment',

            ...context.metadata,

            taskId:
                task.taskId,

            memberId:
                member.memberId,

            ...validation,

            generatedAt:
                this._now().toISOString()
        };
    }

    /**
     * =========================================================================
     * Workload scoring
     * =========================================================================
     */

    calculateWorkloadScore(snapshot) {

        if (!snapshot) {
            return 0;
        }

        const utilization =
            clamp(snapshot.utilization);

        const priorityPressure =
            clamp(
                snapshot.priorityPressure
            );

        const overduePressure =
            clamp(
                snapshot.overduePressure
            );

        const capacityPressure =
            clamp(
                snapshot.capacityPressure
            );

        return round(
            (
                utilization * 0.45 +
                priorityPressure * 0.20 +
                overduePressure * 0.20 +
                capacityPressure * 0.15
            ),
            4
        );
    }

    /**
     * =========================================================================
     * Internal normalization
     * =========================================================================
     */

    _normalizeMembers(members) {

        return safeArray(members)
            .map(member =>
                this._normalizeMember(member)
            )
            .filter(member =>
                Boolean(member.memberId)
            );
    }

    _normalizeMember(member = {}) {

        const source =
            isObject(member)
                ? member
                : {};

        const capacityMinutes =
            isFiniteNumber(source.capacityMinutes)
                ? Math.max(
                    0,
                    toNumber(source.capacityMinutes)
                )
                : (
                    Math.max(
                        0,
                        toNumber(
                            source.dailyCapacityHours,
                            this.config.defaultDailyCapacity
                        )
                    ) * 60
                );

        const maxCapacity =
            isFiniteNumber(source.maxCapacityMinutes)
                ? Math.max(
                    0,
                    toNumber(source.maxCapacityMinutes)
                )
                : capacityMinutes;

        const availability =
            source.available !== undefined
                ? Boolean(source.available)
                : source.isAvailable !== undefined
                    ? Boolean(source.isAvailable)
                    : true;

        return {
            ...clone(source),

            memberId:
                normalizeId(
                    source.memberId ||
                    source.userId ||
                    source.employeeId ||
                    source.id
                ),

            name:
                normalizeString(
                    source.name ||
                    source.displayName ||
                    source.memberName
                ),

            branchId:
                normalizeId(
                    source.branchId
                ),

            tenantId:
                normalizeId(
                    source.tenantId
                ),

            role:
                normalizeString(
                    source.role
                ).toUpperCase(),

            skills:
                normalizeSkills(
                    source.skills || DEFAULT_SKILLS
                ),

            capacityMinutes,

            maxCapacityMinutes:
                Math.max(
                    capacityMinutes,
                    maxCapacity
                ),

            availability,

            active:
                source.active !== undefined
                    ? Boolean(source.active)
                    : source.isActive !== undefined
                        ? Boolean(source.isActive)
                        : true,

            timezone:
                normalizeString(
                    source.timezone,
                    this.config.defaultTimezone
                ),

            currentLoadMinutes:
                Math.max(
                    0,
                    toNumber(
                        source.currentLoadMinutes,
                        0
                    )
                )
        };
    }

    _normalizeTasks(tasks) {

        return safeArray(tasks)
            .map(task =>
                this._normalizeTask(task)
            )
            .filter(task =>
                Boolean(task.taskId)
            )
            .slice(
                0,
                this.config.maximumAssignmentsPerPlan
            );
    }

    _normalizeTask(task = {}) {

        const source =
            isObject(task)
                ? task
                : {};

        const duration =
            Math.max(
                1,
                Math.min(
                    this.config.maxTaskDurationMinutes,
                    toNumber(
                        source.estimatedMinutes ||
                        source.durationMinutes ||
                        source.estimatedDurationMinutes,
                        this.config.defaultTaskDurationMinutes
                    )
                )
            );

        const dueDate =
            parseDate(
                source.dueDate ||
                source.deadline ||
                source.expectedCompletionAt
            );

        const skills =
            normalizeSkills(
                source.requiredSkills ||
                source.skills ||
                DEFAULT_SKILLS
            );

        return {
            ...clone(source),

            taskId:
                normalizeId(
                    source.taskId ||
                    source.id ||
                    source.repairId ||
                    source.statementId
                ),

            tenantId:
                normalizeId(
                    source.tenantId
                ),

            branchId:
                normalizeId(
                    source.branchId
                ),

            type:
                normalizeString(
                    source.type ||
                    source.taskType ||
                    source.repairType ||
                    'GENERAL'
                ).toUpperCase(),

            priority:
                normalizePriority(
                    source.priority
                ),

            priorityWeight:
                priorityWeight(
                    source.priority
                ),

            estimatedMinutes:
                duration,

            requiredSkills:
                skills,

            dueDate,

            createdAt:
                parseDate(
                    source.createdAt
                ),

            startedAt:
                parseDate(
                    source.startedAt
                ),

            completedAt:
                parseDate(
                    source.completedAt
                ),

            status:
                normalizeString(
                    source.status,
                    'PENDING'
                ).toUpperCase(),

            assignedMemberId:
                normalizeId(
                    source.assignedMemberId ||
                    source.memberId ||
                    source.assigneeId
                ),

            branchContinuityWeight:
                clamp(
                    source.branchContinuityWeight,
                    0,
                    1
                ),

            metadata:
                isObject(source.metadata)
                    ? clone(source.metadata)
                    : {}
        };
    }

    _normalizeAssignments(assignments) {

        return safeArray(assignments)
            .map(assignment => {

                const source =
                    isObject(assignment)
                        ? assignment
                        : {};

                return {
                    ...clone(source),

                    assignmentId:
                        normalizeId(
                            source.assignmentId ||
                            source.id
                        ) || generateId('ASG'),

                    taskId:
                        normalizeId(
                            source.taskId
                        ),

                    memberId:
                        normalizeId(
                            source.memberId ||
                            source.assigneeId ||
                            source.userId
                        ),

                    branchId:
                        normalizeId(
                            source.branchId
                        ),

                    estimatedMinutes:
                        Math.max(
                            0,
                            toNumber(
                                source.estimatedMinutes ||
                                source.durationMinutes,
                                this.config.defaultTaskDurationMinutes
                            )
                        ),

                    status:
                        normalizeString(
                            source.status,
                            ASSIGNMENT_STATUS.ASSIGNED
                        ).toUpperCase(),

                    assignedAt:
                        parseDate(
                            source.assignedAt
                        ),

                    dueDate:
                        parseDate(
                            source.dueDate
                        )
                };
            })
            .filter(
                assignment =>
                    Boolean(
                        assignment.taskId &&
                        assignment.memberId
                    )
            );
    }

    /**
     * =========================================================================
     * Workload snapshot
     * =========================================================================
     */

    _buildMemberWorkloadSnapshot(
        member,
        tasks,
        assignments,
        context,
        date = null
    ) {

        const effectiveDate =
            date || this._now();

        const memberAssignments =
            assignments.filter(
                assignment =>
                    normalizeId(assignment.memberId) ===
                    normalizeId(member.memberId) &&
                    this._assignmentActiveForDate(
                        assignment,
                        effectiveDate
                    )
            );

        const taskMap =
            new Map(
                safeArray(tasks).map(
                    task => [
                        normalizeId(task.taskId),
                        task
                    ]
                )
            );

        let allocatedMinutes =
            Math.max(
                0,
                toNumber(
                    member.currentLoadMinutes,
                    0
                )
            );

        let highPriorityMinutes = 0;
        let overdueMinutes = 0;

        for (const assignment of memberAssignments) {

            const task =
                taskMap.get(
                    normalizeId(assignment.taskId)
                );

            const minutes =
                Math.max(
                    0,
                    toNumber(
                        assignment.estimatedMinutes,
                        task
                            ? task.estimatedMinutes
                            : this.config.defaultTaskDurationMinutes
                    )
                );

            allocatedMinutes += minutes;

            if (
                task &&
                (
                    task.priority === 'CRITICAL' ||
                    task.priority === 'HIGH'
                )
            ) {
                highPriorityMinutes += minutes;
            }

            if (
                task &&
                task.dueDate &&
                task.dueDate < effectiveDate &&
                !this._isCompletedStatus(task.status)
            ) {
                overdueMinutes += minutes;
            }
        }

        const capacityMinutes =
            member.availability &&
            member.active
                ? Math.max(
                    0,
                    toNumber(
                        member.capacityMinutes
                    )
                )
                : 0;

        const availableMinutes =
            Math.max(
                0,
                capacityMinutes -
                allocatedMinutes
            );

        const utilization =
            capacityMinutes > 0
                ? allocatedMinutes /
                    capacityMinutes
                : allocatedMinutes > 0
                    ? 1
                    : 0;

        const capacityPressure =
            capacityMinutes > 0
                ? clamp(
                    allocatedMinutes /
                    capacityMinutes
                )
                : allocatedMinutes > 0
                    ? 1
                    : 0;

        const priorityPressure =
            allocatedMinutes > 0
                ? clamp(
                    highPriorityMinutes /
                    allocatedMinutes
                )
                : 0;

        const overduePressure =
            allocatedMinutes > 0
                ? clamp(
                    overdueMinutes /
                    allocatedMinutes
                )
                : 0;

        const status =
            this._deriveWorkloadStatus(
                utilization,
                member.availability &&
                member.active
            );

        const snapshot = {
            memberId:
                member.memberId,

            memberName:
                member.name,

            branchId:
                member.branchId,

            role:
                member.role,

            skills:
                [...member.skills],

            available:
                member.availability &&
                member.active,

            capacityMinutes,

            allocatedMinutes,

            availableMinutes,

            utilization:
                round(utilization),

            capacityPressure:
                round(capacityPressure),

            priorityPressure:
                round(priorityPressure),

            overdueMinutes,

            overduePressure:
                round(overduePressure),

            highPriorityMinutes,

            assignmentCount:
                memberAssignments.length,

            status,

            workloadScore:
                this.calculateWorkloadScore({
                    utilization,
                    priorityPressure,
                    overduePressure,
                    capacityPressure
                })
        };

        snapshot.overflowMinutes =
            Math.max(
                0,
                allocatedMinutes -
                capacityMinutes
            );

        snapshot.capacityHeadroomRatio =
            capacityMinutes > 0
                ? round(
                    availableMinutes /
                    capacityMinutes
                )
                : 0;

        return snapshot;
    }

    _deriveWorkloadStatus(
        utilization,
        available
    ) {

        if (!available) {
            return WORKLOAD_STATUS.UNAVAILABLE;
        }

        if (utilization <= 0) {
            return WORKLOAD_STATUS.EMPTY;
        }

        if (
            utilization <
            this.config.minimumUtilization
        ) {
            return WORKLOAD_STATUS.LOW;
        }

        if (
            utilization >=
            this.config.criticalUtilization
        ) {
            return WORKLOAD_STATUS.CRITICAL;
        }

        if (
            utilization >=
            this.config.maxUtilization
        ) {
            return WORKLOAD_STATUS.HIGH;
        }

        return WORKLOAD_STATUS.BALANCED;
    }

    /**
     * =========================================================================
     * Allocation engine
     * =========================================================================
     */

    _allocateTasks({
        members,
        tasks,
        assignments,
        context
    }) {

        const proposedAssignments = [];
        const deferredTasks = [];
        const blockedTasks = [];

        const mutableAssignments =
            assignments.map(
                assignment => clone(assignment)
            );

        const orderedTasks =
            stableSort(
                tasks,
                (a, b) => {

                    const priorityDifference =
                        b.priorityWeight -
                        a.priorityWeight;

                    if (priorityDifference !== 0) {
                        return priorityDifference;
                    }

                    const aDue =
                        a.dueDate
                            ? a.dueDate.getTime()
                            : Number.MAX_SAFE_INTEGER;

                    const bDue =
                        b.dueDate
                            ? b.dueDate.getTime()
                            : Number.MAX_SAFE_INTEGER;

                    if (aDue !== bDue) {
                        return aDue - bDue;
                    }

                    return (
                        a.taskId.localeCompare(
                            b.taskId
                        )
                    );
                }
            );

        const rationale = [];

        for (const task of orderedTasks) {

            if (
                this._isCompletedStatus(
                    task.status
                )
            ) {
                continue;
            }

            const ranked =
                this._rankCandidates({
                    task,
                    members,
                    assignments:
                        mutableAssignments,
                    tasks,
                    context
                });

            const candidate =
                ranked[0] || null;

            if (!candidate) {

                const blocked =
                    {
                        taskId:
                            task.taskId,

                        priority:
                            task.priority,

                        reason:
                            'No eligible member satisfies capacity, availability or skill requirements.',

                        candidates:
                            ranked
                    };

                blockedTasks.push(blocked);

                continue;
            }

            if (
                candidate.score <
                this.config.minimumConfidence
            ) {

                deferredTasks.push({
                    taskId:
                        task.taskId,

                    priority:
                        task.priority,

                    reason:
                        'Candidate confidence is below the minimum operational threshold.',

                    score:
                        candidate.score,

                    candidate:
                        candidate.memberId
                });

                continue;
            }

            const assignment =
                this._createAssignment(
                    task,
                    candidate,
                    context
                );

            proposedAssignments.push(
                assignment
            );

            mutableAssignments.push(
                assignment
            );

            rationale.push({
                taskId:
                    task.taskId,

                memberId:
                    candidate.memberId,

                score:
                    candidate.score,

                reasons:
                    candidate.reasons
            });
        }

        return {
            assignments:
                proposedAssignments,

            deferredTasks,

            blockedTasks,

            rationale
        };
    }

    _rankCandidates({
        task,
        members,
        assignments,
        tasks,
        context
    }) {

        const candidates = [];

        for (const member of members) {

            const validation =
                this._validateCandidate(
                    task,
                    member,
                    assignments,
                    tasks,
                    context
                );

            if (!validation.eligible) {
                continue;
            }

            const score =
                this._calculateCandidateScore({
                    task,
                    member,
                    assignments,
                    tasks,
                    validation
                });

            candidates.push({
                memberId:
                    member.memberId,

                memberName:
                    member.name,

                branchId:
                    member.branchId,

                score:
                    round(score),

                reasons:
                    validation.reasons,

                availableMinutes:
                    validation.availableMinutes,

                projectedUtilization:
                    validation.projectedUtilization
            });
        }

        return stableSort(
            candidates,
            (a, b) => {

                if (b.score !== a.score) {
                    return b.score - a.score;
                }

                if (
                    b.availableMinutes !==
                    a.availableMinutes
                ) {
                    return (
                        b.availableMinutes -
                        a.availableMinutes
                    );
                }

                return (
                    a.memberId.localeCompare(
                        b.memberId
                    )
                );
            }
        );
    }

    _validateCandidate(
        task,
        member,
        assignments,
        tasks,
        context
    ) {

        const reasons = [];

        if (!member.memberId) {
            return {
                eligible: false,
                reasons: ['MEMBER_ID_MISSING']
            };
        }

        if (
            !member.active ||
            !member.availability
        ) {
            return {
                eligible: false,
                reasons: ['MEMBER_UNAVAILABLE']
            };
        }

        if (
            task.tenantId &&
            member.tenantId &&
            task.tenantId !== member.tenantId
        ) {
            return {
                eligible: false,
                reasons: ['TENANT_MISMATCH']
            };
        }

        if (
            task.branchId &&
            member.branchId &&
            task.branchId !== member.branchId
        ) {
            /**
             * Branch mismatch is not automatically fatal.
             * Cross-branch allocation is allowed only when explicitly
             * permitted by the task/member configuration.
             */
            const crossBranchAllowed =
                task.allowCrossBranch === true ||
                member.allowCrossBranch === true ||
                context.allowCrossBranch === true;

            if (!crossBranchAllowed) {
                return {
                    eligible: false,
                    reasons: ['BRANCH_MISMATCH']
                };
            }

            reasons.push(
                'CROSS_BRANCH_ALLOCATION'
            );
        }

        const requiredSkills =
            safeArray(task.requiredSkills);

        const memberSkills =
            safeArray(member.skills);

        const matchedSkills =
            intersection(
                requiredSkills,
                memberSkills
            );

        if (
            requiredSkills.length &&
            !requiredSkills.every(
                skill =>
                    memberSkills.includes(
                        normalizeString(skill)
                            .toUpperCase()
                    )
            )
        ) {

            const partialSkillMatch =
                matchedSkills.length >
                0;

            if (!partialSkillMatch) {
                return {
                    eligible: false,
                    reasons: ['SKILL_MISMATCH']
                };
            }

            reasons.push(
                'PARTIAL_SKILL_MATCH'
            );
        }

        const currentMinutes =
            this._getMemberAllocatedMinutes(
                member,
                assignments,
                tasks
            );

        const projectedMinutes =
            currentMinutes +
            task.estimatedMinutes;

        const capacity =
            Math.max(
                0,
                member.capacityMinutes
            );

        const projectedUtilization =
            capacity > 0
                ? projectedMinutes / capacity
                : projectedMinutes > 0
                    ? 1
                    : 0;

        if (
            projectedUtilization >
            this.config.criticalUtilization
        ) {
            return {
                eligible: false,

                reasons: [
                    'CAPACITY_CRITICAL'
                ],

                availableMinutes:
                    Math.max(
                        0,
                        capacity -
                        currentMinutes
                    ),

                projectedUtilization
            };
        }

        if (
            projectedUtilization >
            this.config.maxUtilization
        ) {
            reasons.push(
                'CAPACITY_PRESSURE'
            );
        }

        if (
            task.priority === 'CRITICAL' ||
            task.priority === 'HIGH'
        ) {
            reasons.push(
                'PRIORITY_TASK'
            );
        }

        if (
            task.dueDate &&
            task.dueDate < this._now()
        ) {
            reasons.push(
                'OVERDUE_TASK'
            );
        }

        return {
            eligible: true,

            reasons,

            matchedSkills,

            availableMinutes:
                Math.max(
                    0,
                    capacity -
                    currentMinutes
                ),

            projectedUtilization
        };
    }

    _calculateCandidateScore({
        task,
        member,
        assignments,
        tasks,
        validation
    }) {

        const capacity =
            Math.max(
                0,
                member.capacityMinutes
            );

        const utilization =
            capacity > 0
                ? this._getMemberAllocatedMinutes(
                    member,
                    assignments,
                    tasks
                ) / capacity
                : 1;

        const remainingCapacityScore =
            clamp(
                1 -
                utilization
            );

        const projectedPressure =
            clamp(
                validation.projectedUtilization
            );

        const capacityScore =
            clamp(
                (
                    remainingCapacityScore +
                    (1 - projectedPressure)
                ) / 2
            );

        const requiredSkills =
            safeArray(
                task.requiredSkills
            );

        const skillScore =
            requiredSkills.length
                ? clamp(
                    validation.matchedSkills.length /
                    requiredSkills.length
                )
                : 1;

        const urgencyScore =
            this._calculateUrgencyScore(
                task
            );

        const priorityScore =
            clamp(
                priorityWeight(
                    task.priority
                ) / 10
            );

        const continuityScore =
            this._calculateContinuityScore(
                task,
                member,
                assignments,
                tasks
            );

        return clamp(
            urgencyScore *
                this.config.urgencyWeight +

            capacityScore *
                this.config.capacityWeight +

            skillScore *
                this.config.skillWeight +

            priorityScore *
                this.config.priorityWeight +

            continuityScore *
                this.config.continuityWeight
        );
    }

    _calculateUrgencyScore(task) {

        if (!task.dueDate) {
            return 0.50;
        }

        const minutes =
            Math.max(
                0,
                minutesBetween(
                    this._now(),
                    task.dueDate
                )
            );

        if (
            task.dueDate <
            this._now()
        ) {
            return 1;
        }

        if (minutes <= 60) {
            return 1;
        }

        if (minutes <= 240) {
            return 0.90;
        }

        if (minutes <= 1440) {
            return 0.75;
        }

        if (minutes <= 4320) {
            return 0.55;
        }

        return 0.35;
    }

    _calculateContinuityScore(
        task,
        member,
        assignments,
        tasks
    ) {

        if (
            !task.branchId ||
            !member.branchId
        ) {
            return 0.5;
        }

        if (
            task.branchId ===
            member.branchId
        ) {
            return 1;
        }

        const memberTaskCount =
            assignments.filter(
                assignment =>
                    normalizeId(
                        assignment.memberId
                    ) ===
                    normalizeId(
                        member.memberId
                    ) &&
                    normalizeId(
                        assignment.branchId
                    ) ===
                    normalizeId(
                        task.branchId
                    )
            ).length;

        if (memberTaskCount > 0) {
            return 0.75;
        }

        return 0.20;
    }

    _createAssignment(
        task,
        candidate,
        context
    ) {

        return {
            assignmentId:
                generateId('ASG'),

            taskId:
                task.taskId,

            memberId:
                candidate.memberId,

            memberName:
                candidate.memberName,

            tenantId:
                context.tenantId ||
                task.tenantId,

            branchId:
                task.branchId,

            estimatedMinutes:
                task.estimatedMinutes,

            priority:
                task.priority,

            status:
                ASSIGNMENT_STATUS.PROPOSED,

            confidence:
                candidate.score,

            reasons:
                [...candidate.reasons],

            assignedAt:
                this._now().toISOString(),

            dueDate:
                task.dueDate
                    ? task.dueDate.toISOString()
                    : null,

            source:
                'WorkloadBalancer',

            metadata: {
                requestId:
                    context.requestId,

                correlationId:
                    context.correlationId
            }
        };
    }

    /**
     * =========================================================================
     * Rebalancing
     * =========================================================================
     */

    _findMovableAssignments(
        memberId,
        assignments,
        tasks
    ) {

        const taskMap =
            new Map(
                tasks.map(
                    task => [
                        normalizeId(task.taskId),
                        task
                    ]
                )
            );

        return stableSort(
            assignments.filter(
                assignment =>
                    normalizeId(
                        assignment.memberId
                    ) ===
                    normalizeId(memberId)
            ),
            (a, b) => {

                const taskA =
                    taskMap.get(
                        normalizeId(a.taskId)
                    );

                const taskB =
                    taskMap.get(
                        normalizeId(b.taskId)
                    );

                const priorityA =
                    taskA
                        ? taskA.priorityWeight
                        : 1;

                const priorityB =
                    taskB
                        ? taskB.priorityWeight
                        : 1;

                if (
                    priorityA !==
                    priorityB
                ) {
                    return (
                        priorityA -
                        priorityB
                    );
                }

                return (
                    toNumber(
                        b.estimatedMinutes
                    ) -
                    toNumber(
                        a.estimatedMinutes
                    )
                );
            }
        );
    }

    _findBestRebalanceTarget({
        assignment,
        overloadedMemberId,
        members,
        tasks,
        assignments,
        context
    }) {

        const task =
            tasks.find(
                item =>
                    normalizeId(item.taskId) ===
                    normalizeId(assignment.taskId)
            );

        if (!task) {
            return null;
        }

        const candidates =
            this._rankCandidates({
                task,
                members:
                    members.filter(
                        member =>
                            normalizeId(
                                member.memberId
                            ) !==
                            normalizeId(
                                overloadedMemberId
                            )
                    ),
                assignments:
                    assignments.filter(
                        item =>
                            normalizeId(
                                item.assignmentId
                            ) !==
                            normalizeId(
                                assignment.assignmentId
                            )
                    ),
                tasks,
                context
            });

        const candidate =
            candidates[0] || null;

        if (!candidate) {
            return null;
        }

        return {
            memberId:
                candidate.memberId,

            score:
                candidate.score,

            reason:
                'Moved from a higher-pressure resource to a lower-pressure eligible resource.'
        };
    }

    /**
     * =========================================================================
     * Summary / analytics
     * =========================================================================
     */

    _buildWorkloadSummary(
        snapshots,
        tasks
    ) {

        const memberCount =
            snapshots.length;

        const availableMembers =
            snapshots.filter(
                snapshot =>
                    snapshot.available
            ).length;

        const overloadedMembers =
            snapshots.filter(
                snapshot =>
                    snapshot.status ===
                    WORKLOAD_STATUS.HIGH ||
                    snapshot.status ===
                    WORKLOAD_STATUS.CRITICAL
            ).length;

        const criticalMembers =
            snapshots.filter(
                snapshot =>
                    snapshot.status ===
                    WORKLOAD_STATUS.CRITICAL
            ).length;

        const totalCapacity =
            snapshots.reduce(
                (sum, snapshot) =>
                    sum +
                    snapshot.capacityMinutes,
                0
            );

        const totalAllocated =
            snapshots.reduce(
                (sum, snapshot) =>
                    sum +
                    snapshot.allocatedMinutes,
                0
            );

        const averageUtilization =
            memberCount > 0
                ? snapshots.reduce(
                    (sum, snapshot) =>
                        sum +
                        snapshot.utilization,
                    0
                ) / memberCount
                : 0;

        return {
            memberCount,

            availableMembers,

            overloadedMembers,

            criticalMembers,

            totalCapacityMinutes:
                totalCapacity,

            totalAllocatedMinutes:
                totalAllocated,

            totalAvailableMinutes:
                Math.max(
                    0,
                    totalCapacity -
                    totalAllocated
                ),

            averageUtilization:
                round(
                    averageUtilization
                ),

            taskCount:
                safeArray(tasks).length,

            workloadPressure:
                round(
                    totalCapacity > 0
                        ? totalAllocated /
                            totalCapacity
                        : totalAllocated > 0
                            ? 1
                            : 0
                )
        };
    }

    _calculateImbalance(snapshots) {

        const utilizationValues =
            snapshots
                .filter(
                    snapshot =>
                        snapshot.available
                )
                .map(
                    snapshot =>
                        snapshot.utilization
                );

        if (
            utilizationValues.length < 2
        ) {
            return {
                coefficientOfVariation: 0,
                range: 0,
                score: 0,
                severity: 'LOW'
            };
        }

        const mean =
            utilizationValues.reduce(
                (sum, value) =>
                    sum + value,
                0
            ) /
            utilizationValues.length;

        const variance =
            utilizationValues.reduce(
                (sum, value) =>
                    sum +
                    Math.pow(
                        value - mean,
                        2
                    ),
                0
            ) /
            utilizationValues.length;

        const standardDeviation =
            Math.sqrt(variance);

        const coefficientOfVariation =
            mean > 0
                ? standardDeviation / mean
                : 0;

        const min =
            Math.min(
                ...utilizationValues
            );

        const max =
            Math.max(
                ...utilizationValues
            );

        const range =
            max - min;

        const score =
            clamp(
                coefficientOfVariation +
                range / 2
            );

        return {
            coefficientOfVariation:
                round(
                    coefficientOfVariation
                ),

            range:
                round(range),

            score:
                round(score),

            severity:
                score >= 0.50
                    ? 'HIGH'
                    : score >= 0.25
                        ? 'MEDIUM'
                        : 'LOW'
        };
    }

    _calculateAverageUtilizationPressure(
        snapshots
    ) {

        if (!snapshots.length) {
            return 0;
        }

        return snapshots.reduce(
            (sum, snapshot) =>
                sum +
                Math.abs(
                    snapshot.utilization -
                    this.config.maxUtilization
                ),
            0
        ) / snapshots.length;
    }

    _buildPlanUtilization(
        members,
        newAssignments,
        existingAssignments
    ) {

        const allAssignments =
            existingAssignments.concat(
                newAssignments
            );

        return members.map(member => {

            const memberAssignments =
                allAssignments.filter(
                    assignment =>
                        normalizeId(
                            assignment.memberId
                        ) ===
                        normalizeId(
                            member.memberId
                        )
                );

            const allocatedMinutes =
                memberAssignments.reduce(
                    (sum, assignment) =>
                        sum +
                        toNumber(
                            assignment.estimatedMinutes
                        ),
                    0
                );

            const utilization =
                member.capacityMinutes > 0
                    ? allocatedMinutes /
                        member.capacityMinutes
                    : allocatedMinutes > 0
                        ? 1
                        : 0;

            return {
                memberId:
                    member.memberId,

                capacityMinutes:
                    member.capacityMinutes,

                allocatedMinutes,

                availableMinutes:
                    Math.max(
                        0,
                        member.capacityMinutes -
                        allocatedMinutes
                    ),

                utilization:
                    round(utilization),

                status:
                    this._deriveWorkloadStatus(
                        utilization,
                        member.availability &&
                        member.active
                    )
            };
        });
    }

    _calculatePlanConfidence(
        allocation,
        members
    ) {

        const total =
            allocation.assignments.length +
            allocation.deferredTasks.length +
            allocation.blockedTasks.length;

        if (!total) {
            return 1;
        }

        const successRatio =
            allocation.assignments.length /
            total;

        const availableRatio =
            members.length
                ? members.filter(
                    member =>
                        member.active &&
                        member.availability
                ).length /
                members.length
                : 0;

        return round(
            clamp(
                successRatio * 0.75 +
                availableRatio * 0.25
            )
        );
    }

    _calculateRebalanceConfidence(
        changes,
        improved
    ) {

        if (!changes.length) {
            return 1;
        }

        const changeQuality =
            changes.reduce(
                (sum, change) =>
                    sum +
                    toNumber(
                        change.score
                    ),
                0
            ) / changes.length;

        return round(
            clamp(
                changeQuality * 0.80 +
                (improved ? 0.20 : 0)
            )
        );
    }

    /**
     * =========================================================================
     * Recommendations
     * =========================================================================
     */

    _generateBalancingRecommendations(
        snapshots,
        tasks,
        context
    ) {

        const recommendations = [];

        const overloaded =
            snapshots.filter(
                snapshot =>
                    snapshot.status ===
                    WORKLOAD_STATUS.HIGH ||
                    snapshot.status ===
                    WORKLOAD_STATUS.CRITICAL
            );

        const underutilized =
            snapshots.filter(
                snapshot =>
                    snapshot.status ===
                    WORKLOAD_STATUS.EMPTY ||
                    snapshot.status ===
                    WORKLOAD_STATUS.LOW
            );

        for (const snapshot of overloaded) {

            recommendations.push({
                type:
                    'REDUCE_MEMBER_LOAD',

                priority:
                    snapshot.status ===
                    WORKLOAD_STATUS.CRITICAL
                        ? 'CRITICAL'
                        : 'HIGH',

                memberId:
                    snapshot.memberId,

                action:
                    'Reassign eligible lower-priority work to available resources.',

                overflowMinutes:
                    snapshot.overflowMinutes,

                workloadScore:
                    snapshot.workloadScore
            });
        }

        for (const snapshot of underutilized) {

            if (
                !snapshot.available
            ) {
                continue;
            }

            recommendations.push({
                type:
                    'UTILIZE_AVAILABLE_CAPACITY',

                priority:
                    'MEDIUM',

                memberId:
                    snapshot.memberId,

                action:
                    'Consider assigning eligible pending work to available capacity.',

                availableMinutes:
                    snapshot.availableMinutes,

                workloadScore:
                    snapshot.workloadScore
            });
        }

        const criticalTasks =
            safeArray(tasks)
                .filter(
                    task =>
                        task.priority ===
                        'CRITICAL'
                );

        if (criticalTasks.length) {

            recommendations.push({
                type:
                    'PRIORITIZE_CRITICAL_WORK',

                priority:
                    'CRITICAL',

                taskCount:
                    criticalTasks.length,

                action:
                    'Reserve qualified capacity for critical financial statement repair tasks.'
            });
        }

        return recommendations;
    }

    _generateForecastRecommendations(
        days
    ) {

        const recommendations = [];

        for (const day of days) {

            const summary =
                day.summary;

            if (
                summary.criticalMembers > 0
            ) {

                recommendations.push({
                    date:
                        day.date,

                    type:
                        'CAPACITY_RISK',

                    priority:
                        'CRITICAL',

                    action:
                        'Increase operational capacity or redistribute workload before projected overload.'
                });

                continue;
            }

            if (
                summary.overloadedMembers > 0
            ) {

                recommendations.push({
                    date:
                        day.date,

                    type:
                        'LOAD_BALANCING',

                    priority:
                        'HIGH',

                    action:
                        'Rebalance workload before projected utilization exceeds the operational target.'
                });
            }
        }

        return recommendations;
    }

    _calculateForecastPressure(days) {

        if (!days.length) {
            return {
                average: 0,
                peak: 0,
                criticalDays: 0,
                highPressureDays: 0
            };
        }

        const values =
            days.map(
                day =>
                    day.summary.workloadPressure
            );

        return {
            average:
                round(
                    values.reduce(
                        (sum, value) =>
                            sum + value,
                        0
                    ) / values.length
                ),

            peak:
                round(
                    Math.max(...values)
                ),

            criticalDays:
                days.filter(
                    day =>
                        day.summary.criticalMembers >
                        0
                ).length,

            highPressureDays:
                days.filter(
                    day =>
                        day.summary.overloadedMembers >
                        0
                ).length
        };
    }

    /**
     * =========================================================================
     * Date / task state helpers
     * =========================================================================
     */

    _taskRelevantOnDate(
        task,
        date
    ) {

        if (
            this._isCompletedStatus(
                task.status
            )
        ) {
            return false;
        }

        if (!task.dueDate) {
            return true;
        }

        const taskDate =
            new Date(
                task.dueDate.getTime()
            );

        taskDate.setUTCHours(
            23,
            59,
            59,
            999
        );

        return date <= taskDate;
    }

    _assignmentRelevantOnDate(
        assignment,
        date
    ) {

        if (
            assignment.status ===
            ASSIGNMENT_STATUS.BLOCKED
        ) {
            return false;
        }

        if (!assignment.dueDate) {
            return true;
        }

        const dueDate =
            parseDate(
                assignment.dueDate
            );

        if (!dueDate) {
            return true;
        }

        return date <= dueDate;
    }

    _assignmentActiveForDate(
        assignment,
        date
    ) {

        if (
            assignment.status ===
            ASSIGNMENT_STATUS.BLOCKED
        ) {
            return false;
        }

        if (
            assignment.status ===
            'COMPLETED'
        ) {
            return false;
        }

        if (
            assignment.assignedAt
        ) {

            const assignedAt =
                parseDate(
                    assignment.assignedAt
                );

            if (
                assignedAt &&
                assignedAt > date
            ) {
                return false;
            }
        }

        if (
            assignment.dueDate
        ) {

            const dueDate =
                parseDate(
                    assignment.dueDate
                );

            if (
                dueDate &&
                dueDate < date
            ) {
                return false;
            }
        }

        return true;
    }

    _isCompletedStatus(status) {

        return [
            'COMPLETED',
            'CLOSED',
            'RESOLVED',
            'CANCELLED',
            'CANCELED'
        ].includes(
            normalizeString(
                status
            ).toUpperCase()
        );
    }

    /**
     * =========================================================================
     * Member load
     * =========================================================================
     */

    _getMemberAllocatedMinutes(
        member,
        assignments,
        tasks
    ) {

        const taskMap =
            new Map(
                safeArray(tasks).map(
                    task => [
                        normalizeId(
                            task.taskId
                        ),
                        task
                    ]
                )
            );

        return (
            Math.max(
                0,
                toNumber(
                    member.currentLoadMinutes,
                    0
                )
            ) +
            assignments
                .filter(
                    assignment =>
                        normalizeId(
                            assignment.memberId
                        ) ===
                        normalizeId(
                            member.memberId
                        ) &&
                        assignment.status !==
                            ASSIGNMENT_STATUS.BLOCKED
                )
                .reduce(
                    (sum, assignment) => {

                        const task =
                            taskMap.get(
                                normalizeId(
                                    assignment.taskId
                                )
                            );

                        return (
                            sum +
                            Math.max(
                                0,
                                toNumber(
                                    assignment.estimatedMinutes,
                                    task
                                        ? task.estimatedMinutes
                                        : this.config
                                            .defaultTaskDurationMinutes
                                )
                            )
                        );
                    },
                    0
                )
        );
    }

    /**
     * =========================================================================
     * Plan status
     * =========================================================================
     */

    _determinePlanStatus(
        assignments,
        tasks
    ) {

        const taskCount =
            safeArray(tasks).filter(
                task =>
                    !this._isCompletedStatus(
                        task.status
                    )
            ).length;

        const assigned =
            safeArray(assignments).length;

        if (!taskCount) {
            return PLAN_STATUS.EMPTY;
        }

        if (assigned === 0) {
            return PLAN_STATUS.BLOCKED;
        }

        if (assigned < taskCount) {
            return PLAN_STATUS.PARTIAL;
        }

        return PLAN_STATUS.PLANNED;
    }

    _emptyPlan(context) {

        return {
            planId:
                generateId('WBP'),

            operation:
                'plan',

            ...context.metadata,

            status:
                PLAN_STATUS.EMPTY,

            assignments: [],

            deferredTasks: [],

            blockedTasks: [],

            utilization: [],

            rationale: [],

            confidence: 1,

            createdAt:
                this._now().toISOString()
        };
    }

    /**
     * =========================================================================
     * Context / tenancy / idempotency
     * =========================================================================
     */

    _createContext(
        input,
        operation
    ) {

        const source =
            isObject(input)
                ? input
                : {};

        const tenantId =
            normalizeId(
                source.tenantId ||
                source.context?.tenantId
            );

        const requestId =
            normalizeId(
                source.requestId ||
                source.context?.requestId
            ) ||
            generateId('REQ');

        const correlationId =
            normalizeId(
                source.correlationId ||
                source.context?.correlationId
            ) ||
            requestId;

        return {
            operation,

            tenantId,

            requestId,

            correlationId,

            idempotencyKey:
                normalizeId(
                    source.idempotencyKey
                ),

            allowCrossBranch:
                source.allowCrossBranch === true,

            metadata: {
                tenantId:
                    tenantId || null,

                requestId,

                correlationId,

                idempotencyKey:
                    normalizeId(
                        source.idempotencyKey
                    ) || null
            }
        };
    }

    /**
     * =========================================================================
     * Persistence hooks
     * =========================================================================
     */

    async _persistPlan(
        plan,
        context
    ) {

        if (
            !this.repository ||
            typeof this.repository.savePlan !==
                'function'
        ) {
            return null;
        }

        try {

            return await this.repository.savePlan(
                clone(plan),
                {
                    tenantId:
                        context.tenantId,

                    requestId:
                        context.requestId,

                    correlationId:
                        context.correlationId,

                    idempotencyKey:
                        context.idempotencyKey
                }
            );

        } catch (error) {

            this._logError(
                'Failed to persist workload plan.',
                error,
                context
            );

            throw error;
        }
    }

    async _persistRebalance(
        result,
        context
    ) {

        if (
            !this.repository ||
            typeof this.repository.saveRebalance !==
                'function'
        ) {
            return null;
        }

        try {

            return await this.repository.saveRebalance(
                clone(result),
                {
                    tenantId:
                        context.tenantId,

                    requestId:
                        context.requestId,

                    correlationId:
                        context.correlationId
                }
            );

        } catch (error) {

            this._logError(
                'Failed to persist workload rebalance.',
                error,
                context
            );

            throw error;
        }
    }

    /**
     * =========================================================================
     * Observability
     * =========================================================================
     */

    async _withTelemetry(
        operation,
        context,
        handler
    ) {

        const startedAt =
            this._now();

        if (
            this.telemetry &&
            typeof this.telemetry.startSpan ===
                'function'
        ) {

            const span =
                this.telemetry.startSpan(
                    operation,
                    {
                        tenantId:
                            context.tenantId,

                        requestId:
                            context.requestId,

                        correlationId:
                            context.correlationId
                    }
                );

            try {

                const result =
                    await handler();

                if (
                    span &&
                    typeof span.setStatus ===
                        'function'
                ) {
                    span.setStatus({
                        code: 'OK'
                    });
                }

                return result;

            } catch (error) {

                if (
                    span &&
                    typeof span.recordException ===
                        'function'
                ) {
                    span.recordException(error);
                }

                throw error;

            } finally {

                if (
                    span &&
                    typeof span.end ===
                        'function'
                ) {
                    span.end();
                }
            }
        }

        try {

            const result =
                await handler();

            this._recordMetric(
                'workload_operation_duration_ms',
                this._now().getTime() -
                    startedAt.getTime(),
                {
                    operation,
                    tenantId:
                        context.tenantId
                }
            );

            return result;

        } catch (error) {

            this._recordMetric(
                'workload_operation_error',
                1,
                {
                    operation,
                    tenantId:
                        context.tenantId
                }
            );

            throw error;
        }
    }

    _recordMetric(
        name,
        value,
        labels = {}
    ) {

        if (!this.metrics) {
            return;
        }

        try {

            if (
                typeof this.metrics.increment ===
                    'function' &&
                Number.isInteger(value)
            ) {

                this.metrics.increment(
                    name,
                    value,
                    labels
                );

                return;
            }

            if (
                typeof this.metrics.observe ===
                    'function'
            ) {

                this.metrics.observe(
                    name,
                    value,
                    labels
                );
            }

        } catch (error) {

            this._logWarn(
                'Workload metrics emission failed.',
                {
                    metric: name,
                    error: error.message
                }
            );
        }
    }

    _logInfo(
        message,
        metadata = {}
    ) {

        if (!this.logger) {
            return;
        }

        try {

            if (
                typeof this.logger.info ===
                    'function'
            ) {

                this.logger.info(
                    message,
                    metadata
                );
            }

        } catch (error) {
            // Logging must never break financial operations.
        }
    }

    _logWarn(
        message,
        metadata = {}
    ) {

        if (!this.logger) {
            return;
        }

        try {

            if (
                typeof this.logger.warn ===
                    'function'
            ) {

                this.logger.warn(
                    message,
                    metadata
                );
            }

        } catch (error) {
            // Logging must never break financial operations.
        }
    }

    _logError(
        message,
        error,
        context = {}
    ) {

        if (!this.logger) {
            return;
        }

        try {

            if (
                typeof this.logger.error ===
                    'function'
            ) {

                this.logger.error(
                    message,
                    {
                        error:
                            error
                                ? {
                                    name:
                                        error.name,

                                    message:
                                        error.message,

                                    code:
                                        error.code,

                                    stack:
                                        error.stack
                                }
                                : null,

                        tenantId:
                            context.tenantId,

                        requestId:
                            context.requestId,

                        correlationId:
                            context.correlationId
                    }
                );
            }

        } catch (loggingError) {
            // Logging must never mask the original failure.
        }
    }

    /**
     * =========================================================================
     * Validation / errors
     * =========================================================================
     */

    _validateConfiguration() {

        if (
            this.config.maxUtilization <= 0 ||
            this.config.maxUtilization > 1
        ) {
            throw new RangeError(
                'maxUtilization must be greater than 0 and <= 1.'
            );
        }

        if (
            this.config.criticalUtilization <
            this.config.maxUtilization ||
            this.config.criticalUtilization > 1.5
        ) {
            throw new RangeError(
                'criticalUtilization must be >= maxUtilization.'
            );
        }

        if (
            this.config.defaultTaskDurationMinutes <= 0
        ) {
            throw new RangeError(
                'defaultTaskDurationMinutes must be greater than zero.'
            );
        }
    }

    _error(
        code,
        message,
        details = undefined
    ) {

        const error =
            new Error(message);

        error.name =
            'WorkloadBalancerError';

        error.code =
            code;

        if (details !== undefined) {
            error.details =
                details;
        }

        return error;
    }

    /**
     * =========================================================================
     * Clock
     * =========================================================================
     */

    _now() {

        try {

            if (
                this.clock &&
                typeof this.clock.now ===
                    'function'
            ) {

                const value =
                    this.clock.now();

                const parsed =
                    parseDate(value);

                if (parsed) {
                    return parsed;
                }
            }

        } catch (error) {
            this._logWarn(
                'Injected workload clock failed; using system clock.'
            );
        }

        return new Date();
    }
}

/**
 * ============================================================================
 * Static constants
 * ============================================================================
 */

WorkloadBalancer.DEFAULTS =
    DEFAULTS;

WorkloadBalancer.WORKLOAD_STATUS =
    WORKLOAD_STATUS;

WorkloadBalancer.ASSIGNMENT_STATUS =
    ASSIGNMENT_STATUS;

WorkloadBalancer.PLAN_STATUS =
    PLAN_STATUS;

WorkloadBalancer.PRIORITY_WEIGHT =
    PRIORITY_WEIGHT;

/**
 * ============================================================================
 * Factory
 * ============================================================================
 */

function createWorkloadBalancer(
    dependencies = {}
) {
    return new WorkloadBalancer(
        dependencies
    );
}

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports =
    WorkloadBalancer;

module.exports.WorkloadBalancer =
    WorkloadBalancer;

module.exports.createWorkloadBalancer =
    createWorkloadBalancer;

module.exports.WORKLOAD_STATUS =
    WORKLOAD_STATUS;

module.exports.ASSIGNMENT_STATUS =
    ASSIGNMENT_STATUS;

module.exports.PLAN_STATUS =
    PLAN_STATUS;

module.exports.DEFAULTS =
    DEFAULTS;