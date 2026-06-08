## model fine tuning script

A simple QLoRA fine-tuning script for a lightweight Gemma 4 model using Hugging Face TRL + PEFT + W&B. TRL’s `SFTTrainer` supports supervised fine-tuning, Google’s Gemma guide uses TRL/QLoRA, and W&B/Weave can track training/evals.


```bash
pip install -U torch transformers datasets accelerate peft trl bitsandbytes wandb weave
wandb login
huggingface-cli login
```

Expected dataset format: `medical_dental_train.jsonl`
```jsonl
{"instruction":"What are signs of gingivitis?","input":"","output":"Common signs include red, swollen gums, bleeding while brushing or flossing, and bad breath. Patients should see a dental professional for diagnosis."}
{"instruction":"Explain post-extraction care.","input":"adult molar extraction","output":"Bite on gauze as directed, avoid smoking or straws for 24 hours, use prescribed medication only as directed, and contact the dentist for heavy bleeding, fever, or worsening pain."}
```

Run it with
```bash
python fine_tune_gemma4_med_dental.py
```

Important for medical/dental data: remove PHI/PII, keep outputs cautious, avoid diagnosis-only answers, and include “see a licensed clinician/dentist” language for triage or risky symptoms.
