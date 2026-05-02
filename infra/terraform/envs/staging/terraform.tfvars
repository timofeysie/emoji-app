aws_region  = "ap-southeast-2"
environment = "staging"

# Pinned to the immutable tag created in pre-T0. CI in T8 will switch
# to digest pinning.
image_uri = "100641718971.dkr.ecr.ap-southeast-2.amazonaws.com/emoji-app:staging-2026-04-27"

# Set to true only after creating emoji-app/staging/openai-api-key in
# Secrets Manager (see pre-T0 gap #1).
openai_secret_enabled = false

cognito_region = "ap-southeast-2"
# Fill in once Cognito staging user pool is provisioned (Milestone 6).
cognito_user_pool_id  = ""
cognito_app_client_id = ""
