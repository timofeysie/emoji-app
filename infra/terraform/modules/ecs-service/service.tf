resource "aws_ecs_service" "app" {
  name            = var.service_name
  cluster         = aws_ecs_cluster.this.id
  task_definition = aws_ecs_task_definition.this.arn
  launch_type     = "FARGATE"
  desired_count   = var.desired_count

  # Default VPC subnets are public (auto-assign public IP), and the task
  # needs internet egress to pull from ECR and reach Secrets Manager. With
  # assign_public_ip = true and no NAT gateway, traffic exits via the IGW.
  # Switching to private subnets in T9 would require either a NAT gateway
  # or VPC endpoints for ECR + Secrets Manager + CloudWatch Logs.
  network_configuration {
    subnets          = var.subnet_ids
    security_groups  = [var.ecs_security_group_id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = var.target_group_arn
    container_name   = var.container_name
    container_port   = var.container_port
  }

  # Give the container time to boot, register with the target group, and
  # start passing health checks before ECS considers a deployment failed.
  health_check_grace_period_seconds = var.health_check_grace_period_seconds

  deployment_minimum_healthy_percent = 100
  deployment_maximum_percent         = 200

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  # ECS Exec is invaluable for debugging the staging container without
  # rebuilding the image. The task role does not currently grant SSM channel
  # permissions; that is a small follow-up if we ever exercise this in earnest.
  enable_execute_command = var.enable_execute_command

  # Fail fast on the apply if the service can't reach steady state - better to
  # see the failure during apply than to discover it minutes later in the
  # console.
  wait_for_steady_state = var.wait_for_steady_state

  # Once we have an autoscaling policy in T9, desired_count will be managed
  # outside Terraform. Adding it here now is safe (ignored block); flipping
  # the lifecycle ignore_changes later is a no-op for state.
  lifecycle {
    ignore_changes = [
      # Reserved for T9 autoscaling. Empty today.
    ]
  }

  depends_on = [
    aws_ecs_cluster_capacity_providers.this,
    aws_cloudwatch_log_group.app,
  ]
}
