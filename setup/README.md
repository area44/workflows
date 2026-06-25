# area44/setup

Shared setup for AREA44 composite actions. Encapsulates Node.js detection, package manager setup, and dependency installation.

## Usage

Internal action used by other actions in this repository.

## Inputs

| Name                | Description                                | Default |
| ------------------- | ------------------------------------------ | ------- |
| `node-version`      | Optional Node.js version override          | (auto)  |
| `working-directory` | The directory where the project is located | `.`     |
| `install`           | Whether to install dependencies            | `true`  |

## Outputs

| Name                      | Description                             |
| ------------------------- | --------------------------------------- |
| `node-version`            | The Node.js version used                |
| `package-manager`         | The package manager used                |
| `package-manager-version` | The version of the package manager used |
