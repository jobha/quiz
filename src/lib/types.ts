export type Phase = "lobby" | "asking" | "revealed" | "ended";
export type QuestionType = "text" | "choice" | "numeric" | "multi";

export type Room = {
  code: string;
  phase: Phase;
  current_question_id: string | null;
  show_scoreboard: boolean;
  show_own_score: boolean;
  show_history: boolean;
  hide_rejoin_codes: boolean;
  accent_color: string | null;
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
  correct_answers: string[] | null; // for type='multi'
  tolerance: number | null;          // for type='numeric'
  points: number;
  image_url: string | null;
  audio_url: string | null;
  revealed: boolean;
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
  points_awarded: number | null;
  submitted_at: string;
};
