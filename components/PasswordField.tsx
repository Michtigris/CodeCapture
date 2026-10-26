"use client";

import { useState } from "react";

type Props = {
  label: string;
  name?: string;
  value?: string;
  onChange?: (value: string) => void;
  autoComplete?: string;
  minLength?: number;
  required?: boolean;
};

export function PasswordField({
  label,
  name,
  value,
  onChange,
  autoComplete,
  minLength = 6,
  required = true,
}: Props) {
  const [show, setShow] = useState(false);
  return (
    <label className="field">
      <span>{label}</span>
      <div className="secret">
        <input
          name={name}
          value={onChange ? value : undefined}
          onChange={onChange ? (event) => onChange(event.target.value) : undefined}
          type={show ? "text" : "password"}
          autoComplete={autoComplete}
          minLength={minLength}
          required={required}
        />
        <button
          type="button"
          className="eye"
          aria-pressed={show}
          onClick={() => setShow((current) => !current)}
        >
          {show ? "Masquer" : "Voir"}
        </button>
      </div>
    </label>
  );
}
