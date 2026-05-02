provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      app         = "emoji-app"
      environment = var.environment
      managed_by  = "terraform"
    }
  }
}

# Module wiring is added milestone-by-milestone:
#   - T2 enables module.network
#   - T3 enables module.alb
#   - T4 enables module.iam_ecs
#   - T5/T6 enables module.ecs_service
#   - T7 enables module.acm
#
# Each block stays commented out until the corresponding module has resources
# defined. This keeps `terraform plan` clean during the import-first phase.
#
# module "network" {
#   source      = "../../modules/network"
#   environment = var.environment
# }
#
# module "alb" {
#   source                = "../../modules/alb"
#   environment           = var.environment
#   vpc_id                = module.network.vpc_id
#   subnet_ids            = module.network.subnet_ids
#   alb_security_group_id = module.network.alb_security_group_id
# }
#
# module "iam_ecs" {
#   source                    = "../../modules/iam-ecs"
#   environment               = var.environment
#   mongodb_uri_secret_arn    = data.aws_secretsmanager_secret.mongodb_uri.arn
#   openai_api_key_secret_arn = var.openai_secret_enabled ? data.aws_secretsmanager_secret.openai_api_key[0].arn : null
# }
#
# module "ecs_service" {
#   source                  = "../../modules/ecs-service"
#   environment             = var.environment
#   aws_region              = var.aws_region
#   image_uri               = var.image_uri
#   cognito_user_pool_id    = var.cognito_user_pool_id
#   cognito_app_client_id   = var.cognito_app_client_id
#   cognito_region          = var.cognito_region
#   execution_role_arn      = module.iam_ecs.execution_role_arn
#   task_role_arn           = module.iam_ecs.task_role_arn
#   target_group_arn        = module.alb.target_group_arn
#   subnet_ids              = module.network.subnet_ids
#   ecs_security_group_id   = module.network.ecs_security_group_id
#   mongodb_uri_secret_arn  = data.aws_secretsmanager_secret.mongodb_uri.arn
#   openai_secret_enabled   = var.openai_secret_enabled
# }
