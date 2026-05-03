resource "aws_ecs_cluster" "this" {
  name = var.cluster_name

  setting {
    name  = "containerInsights"
    value = var.enable_container_insights ? "enabled" : "disabled"
  }
}

# We use launch_type = "FARGATE" on the service rather than a capacity-provider
# strategy here. That keeps the staging path simple and explicit; switching to
# FARGATE_SPOT (or mixed strategies) later is a one-resource change in this
# module without touching the cluster.
#
# Account bootstrap note: the AWSServiceRoleForECS service-linked role must
# exist before this resource runs. AWS auto-creates the role during the first
# ECS cluster creation in an account, but on a brand-new account the
# PutClusterCapacityProviders call here can fire microseconds before IAM has
# finished propagating the role and fail with
# "Unable to assume the service linked role". A simple `terraform apply`
# retry resolves it because the role is permanent once created. We keep the
# SLR out of Terraform on purpose - it is account-scoped, not module-scoped.
resource "aws_ecs_cluster_capacity_providers" "this" {
  cluster_name       = aws_ecs_cluster.this.name
  capacity_providers = ["FARGATE", "FARGATE_SPOT"]

  default_capacity_provider_strategy {
    base              = 0
    weight            = 1
    capacity_provider = "FARGATE"
  }
}
