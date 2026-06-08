# fine_tune_gemma4_med_dental.py

import os
import wandb
import weave
import torch

from datasets import load_dataset
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
)
from peft import LoraConfig
from trl import SFTTrainer, SFTConfig


# -----------------------------
# Config
# -----------------------------

MODEL_ID = os.getenv("MODEL_ID", "google/gemma-4-e2b-it")  # change if HF ID differs
DATA_PATH = os.getenv("DATA_PATH", "medical_dental_train.jsonl")
OUTPUT_DIR = os.getenv("OUTPUT_DIR", "./gemma4-med-dental-lora")

WANDB_PROJECT = "gemma4-med-dental-ft"
WEAVE_PROJECT = "gemma4-med-dental-eval"

MAX_SEQ_LENGTH = 2048


# -----------------------------
# W&B / Weave init
# -----------------------------

wandb.init(
    project=WANDB_PROJECT,
    name="gemma4-e2b-med-dental-qlora",
    config={
        "model_id": MODEL_ID,
        "dataset": DATA_PATH,
        "method": "QLoRA SFT",
        "max_seq_length": MAX_SEQ_LENGTH,
    },
)

weave.init(WEAVE_PROJECT)


# -----------------------------
# Dataset formatting
# -----------------------------

def format_example(example):
    instruction = example.get("instruction", "").strip()
    user_input = example.get("input", "").strip()
    output = example.get("output", "").strip()

    user_content = instruction
    if user_input:
        user_content += f"\n\nContext:\n{user_input}"

    # Gemma instruction/chat-style text
    return {
        "text": (
            "<start_of_turn>user\n"
            f"{user_content}\n"
            "<end_of_turn>\n"
            "<start_of_turn>model\n"
            f"{output}\n"
            "<end_of_turn>"
        )
    }


dataset = load_dataset("json", data_files=DATA_PATH, split="train")
dataset = dataset.map(format_example, remove_columns=dataset.column_names)

split = dataset.train_test_split(test_size=0.05, seed=42)
train_dataset = split["train"]
eval_dataset = split["test"]


# -----------------------------
# Tokenizer / model
# -----------------------------

tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, use_fast=True)

if tokenizer.pad_token is None:
    tokenizer.pad_token = tokenizer.eos_token

bnb_config = BitsAndBytesConfig(
    load_in_4bit=True,
    bnb_4bit_quant_type="nf4",
    bnb_4bit_compute_dtype=torch.bfloat16,
    bnb_4bit_use_double_quant=True,
)

model = AutoModelForCausalLM.from_pretrained(
    MODEL_ID,
    quantization_config=bnb_config,
    device_map="auto",
    torch_dtype=torch.bfloat16,
)

model.config.use_cache = False


# -----------------------------
# LoRA config
# -----------------------------

peft_config = LoraConfig(
    r=16,
    lora_alpha=32,
    lora_dropout=0.05,
    bias="none",
    task_type="CAUSAL_LM",
    target_modules=[
        "q_proj",
        "k_proj",
        "v_proj",
        "o_proj",
        "gate_proj",
        "up_proj",
        "down_proj",
    ],
)


# -----------------------------
# Training config
# -----------------------------

training_args = SFTConfig(
    output_dir=OUTPUT_DIR,
    dataset_text_field="text",
    max_seq_length=MAX_SEQ_LENGTH,

    num_train_epochs=2,
    per_device_train_batch_size=1,
    per_device_eval_batch_size=1,
    gradient_accumulation_steps=8,

    learning_rate=2e-4,
    warmup_ratio=0.03,
    lr_scheduler_type="cosine",

    logging_steps=10,
    eval_strategy="steps",
    eval_steps=100,
    save_steps=100,
    save_total_limit=2,

    bf16=True,
    optim="paged_adamw_8bit",

    report_to=["wandb"],
    run_name="gemma4-e2b-med-dental-qlora",

    packing=False,
)


trainer = SFTTrainer(
    model=model,
    args=training_args,
    train_dataset=train_dataset,
    eval_dataset=eval_dataset,
    peft_config=peft_config,
    processing_class=tokenizer,
)


# -----------------------------
# Train
# -----------------------------

trainer.train()

trainer.save_model(OUTPUT_DIR)
tokenizer.save_pretrained(OUTPUT_DIR)

wandb.finish()


# -----------------------------
# Simple Weave-tracked smoke eval
# -----------------------------

@weave.op()
def generate_answer(prompt: str) -> str:
    inputs = tokenizer(
        f"<start_of_turn>user\n{prompt}\n<end_of_turn>\n<start_of_turn>model\n",
        return_tensors="pt",
    ).to(model.device)

    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=256,
            temperature=0.2,
            do_sample=False,
            pad_token_id=tokenizer.eos_token_id,
        )

    return tokenizer.decode(outputs[0], skip_special_tokens=True)


test_prompt = (
    "A patient reports bleeding gums when brushing. "
    "Give a cautious dental explanation and recommend next steps."
)

print(generate_answer(test_prompt))