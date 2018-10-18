import PropTypes from 'prop-types';
import React from 'react';
import {t} from 'app/locale';
import styled from 'react-emotion';

import AsyncView from 'app/views/asyncView';
import Button from 'app/components/button';
import {PanelItem} from 'app/components/panels';

const STEPS = {
  tag: 'Tag an error',
  repo: 'Link to a repo',
  commit: 'Associate commits',
  deploy: 'Tell sentry about a deploy',
};

class ReleaseProgress extends AsyncView {
  static contextTypes = {
    organization: PropTypes.object,
    project: PropTypes.object,
    router: PropTypes.object,
  };

  constructor(props, context) {
    super(props, context);
  }

  getTitle() {
    return t('ReleaseProgress');
  }

  getEndpoints() {
    let {project, organization} = this.context;
    let data = {
      organization_id: organization.id,
      feature: 'releases',
    };
    return [
      ['promptsActivity', '/promptsactivity/', {data}],
      [
        'setupStatus',
        `/projects/${organization.slug}/${project.slug}/releases/completion/`,
      ],
    ];
  }
  onRequestSuccess({stateKey, data, jqXHR}) {
    if (stateKey === 'promptsActivity') {
      this.showBar(data);
    } else if (stateKey === 'setupStatus') {
      this.getRemainingSteps();
    }
  }

  getRemainingSteps() {
    let {setupStatus} = this.state;
    let remainingSteps;
    if (setupStatus) {
      remainingSteps = setupStatus
        .filter(step => step.complete === false)
        .map(displayStep => STEPS[displayStep.step]);

      this.setState({
        remainingSteps,
      });
    }
  }

  showBar(prompt) {
    let data = prompt.data;

    let show = data
      ? data && data.status !== 'snoozed' && data.status !== 'dismissed'
      : true;

    this.setState({showBar: show});
  }

  handleClick(action) {
    let {project, organization} = this.context;
    this.api.request('/promptsactivity/', {
      method: 'PUT',
      data: {
        organization_id: organization.id,
        project_id: project.id,
        feature: 'releases',
        status: action,
      },
      success: data => {
        this.setState({showBar: false});
      },
    });
  }

  renderBody() {
    let {remainingSteps, showBar} = this.state;
    let style = {
      height: '100%',
      width: '50%',
    };
    return remainingSteps && showBar ? (
      <PanelItem>
        <div className="col-sm-6">
          <div>
            <h4 className="text-light"> {t("Releases aren't 100% set up")}</h4>
            <div data-test-id="releases-progress-bar" className="releases-progress-bar">
              <div className="slider" style={style} />
            </div>
            {t('Next steps:')}
            <ul>
              {this.state.remainingSteps.map((step, i) => {
                return <li key={i}>{step}</li>;
              })}
            </ul>
          </div>
        </div>

        <div className="col-sm-6">
          <div className="pull-right">
            <StyledButton
              className="text-light"
              onClick={() => this.handleClick('dismissed')}
              size="large"
            >
              {t('Dismiss')}
            </StyledButton>
            <StyledButton
              className="text-light"
              onClick={() => this.handleClick('snoozed')}
              size="large"
            >
              {t('Remind Me Later')}
            </StyledButton>
          </div>
        </div>
      </PanelItem>
    ) : (
      ''
    );
  }
}

const StyledButton = styled(Button)`
  margin: 5px;
`;

export default ReleaseProgress;
