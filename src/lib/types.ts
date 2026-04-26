export type Phase = "lobby" | "asking" | "revealed" | "ended";
export type QuestionType = "text" | "choice";

export type Room = {
  code: string;
  phase: Phase;
  current_question_id: string | null;
  created_at: string;
};

export type Question = {
  id: string;
  room_code: string;
  position: number;
  type: QuestionType;
  prompt: string;
  choices: string[] | null;
  correct_answer: string;
  points: number;
  created_at: string;
};

export type Player = {
  id: string;
  room_code: string;
  name: string;
  rejoin_code: string | null;
  created_at: string;
};

export type Answer = {
  id: string;
  room_code: string;
  question_id: string;
  player_id: string;
  answer: string;
  is_correct: boolean | null;
  submitted_at: string;
};
