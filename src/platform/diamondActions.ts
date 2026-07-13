export type DiamondActionDefinition = {
  id: string;
  amount: number;
  reason: string;
  requiresConfirm: boolean;
  repeatable: boolean;
};

export const DIAMOND_ACTIONS = [
  {
    id: "oracle-summon-1",
    amount: 100,
    reason: "고양이 오디세이 신탁 소환 1회",
    requiresConfirm: true,
    repeatable: true
  },
  {
    id: "oracle-summon-10",
    amount: 900,
    reason: "고양이 오디세이 신탁 소환 10회",
    requiresConfirm: true,
    repeatable: true
  },
  {
    id: "battle-rescue",
    amount: 60,
    reason: "고양이 오디세이 구조 요청",
    requiresConfirm: true,
    repeatable: true
  },
  {
    id: "blessing-reroll",
    amount: 30,
    reason: "고양이 오디세이 가호 재선택",
    requiresConfirm: true,
    repeatable: true
  },
  {
    id: "storm-extra-run",
    amount: 40,
    reason: "고양이 오디세이 폭풍 항로 추가 출항",
    requiresConfirm: true,
    repeatable: true
  },
  {
    id: "raid-extra-key",
    amount: 50,
    reason: "고양이 오디세이 토벌 열쇠 보충",
    requiresConfirm: true,
    repeatable: true
  },
  {
    id: "awakening-materials",
    amount: 120,
    reason: "고양이 오디세이 각성 재료 보충",
    requiresConfirm: true,
    repeatable: true
  },
  {
    id: "vault-expansion",
    amount: 180,
    reason: "고양이 오디세이 보물고 확장",
    requiresConfirm: true,
    repeatable: false
  }
] as const satisfies readonly DiamondActionDefinition[];

export type DiamondActionId = (typeof DIAMOND_ACTIONS)[number]["id"];

const ACTIONS_BY_ID = new Map<string, DiamondActionDefinition>(
  DIAMOND_ACTIONS.map((action) => [action.id, action])
);

export function getDiamondAction(id: string): DiamondActionDefinition | undefined {
  return ACTIONS_BY_ID.get(id);
}

export function isDiamondActionId(id: string): id is DiamondActionId {
  return ACTIONS_BY_ID.has(id);
}

/** The manifest is the host authority; every declared action has a committed reward path. */
export function isDiamondActionAvailable(_id: DiamondActionId): boolean {
  return true;
}

export function matchesDiamondAction(
  input: Pick<LemSpendInput, "id" | "amount" | "reason" | "requiresConfirm">,
  action: DiamondActionDefinition
): boolean {
  return (
    input.id === action.id &&
    input.amount === action.amount &&
    input.reason === action.reason &&
    input.requiresConfirm === action.requiresConfirm
  );
}

export function createSpendInput(
  actionId: DiamondActionId,
  idempotencyKey: string
): LemSpendInput {
  const action = getDiamondAction(actionId);
  if (!action) {
    throw new Error(`Unknown diamond action: ${actionId}`);
  }
  return {
    id: action.id,
    amount: action.amount,
    reason: action.reason,
    requiresConfirm: action.requiresConfirm,
    idempotencyKey
  };
}
