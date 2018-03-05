import PropTypes from 'prop-types';
import React from 'react';
import createReactClass from 'create-react-class';
import Reflux from 'reflux';
import {Link, browserHistory} from 'react-router';
import Cookies from 'js-cookie';
import {StickyContainer, Sticky} from 'react-sticky';
import classNames from 'classnames';

import ApiMixin from '../../mixins/apiMixin';
import GroupStore from '../../stores/groupStore';
import StreamTagStore from '../../stores/streamTagStore';
import EnvironmentStore from '../../stores/environmentStore';
import LoadingError from '../../components/loadingError';
import LoadingIndicator from '../../components/loadingIndicator';
import ProjectState from '../../mixins/projectState';
import Pagination from '../../components/pagination';
import StreamGroup from '../../components/stream/group';
import StreamActions from './../stream/actions';
import StreamTagActions from '../../actions/streamTagActions';
import AlertActions from '../../actions/alertActions';
import StreamFilters from './../stream/filters';
import StreamSidebar from './../stream/sidebar';
import TimeSince from '../../components/timeSince';
import utils from '../../utils';
import queryString from '../../utils/queryString';
import {logAjaxError} from '../../utils/logging';
import parseLinkHeader from '../../utils/parseLinkHeader';
import {t, tn, tct} from '../../locale';
import {setActiveEnvironment} from '../../actionCreators/environments';

const MAX_TAGS = 500;
const MAX_ITEMS = 25;
const DEFAULT_SORT = 'date';
const DEFAULT_STATS_PERIOD = '24h';

const Stream = createReactClass({
  displayName: 'Stream',

  propTypes: {
    environment: PropTypes.object,
  },

  mixins: [
    Reflux.listenTo(GroupStore, 'onGroupChange'),
    Reflux.listenTo(StreamTagStore, 'onStreamTagChange'),
    ApiMixin,
    ProjectState,
  ],

  getInitialState() {
    let searchId = this.props.params.searchId || null;
    let project = this.getProject();
    let realtimeActiveCookie = Cookies.get('realtimeActive');
    let realtimeActive =
      typeof realtimeActiveCookie === 'undefined'
        ? project && !project.firstEvent
        : realtimeActiveCookie === 'true';

    let hasEnvironmentsFeature = new Set(this.getOrganization().features).has(
      'environments'
    );
    let currentQuery = this.props.location.query || {};
    let sort = 'sort' in currentQuery ? currentQuery.sort : DEFAULT_SORT;

    let hasQuery = 'query' in currentQuery;
    let validStatsPeriods = new Set(['14d', '24h']);
    let statsPeriod =
      validStatsPeriods.has(currentQuery.statsPeriod) || DEFAULT_STATS_PERIOD;

    return {
      groupIds: [],
      isDefaultSearch: false,
      searchId: hasQuery ? null : searchId,
      // if we have no query then we can go ahead and fetch data
      loading: searchId || !this.hasQuery() ? true : false,
      savedSearchLoading: true,
      savedSearchList: [],
      selectAllActive: false,
      multiSelected: false,
      anySelected: false,
      statsPeriod,
      realtimeActive,
      pageLinks: '',
      queryCount: null,
      dataLoading: true,
      error: false,
      query: hasQuery ? currentQuery.query : '',
      sort,
      tags: StreamTagStore.getAllTags(),
      tagsLoading: true,
      isSidebarVisible: false,
      processingIssues: null,
      hasEnvironmentsFeature,
    };
  },

  componentWillMount() {
    this._streamManager = new utils.StreamManager(GroupStore);
    this._poller = new utils.CursorPoller({
      success: this.onRealtimePoll,
    });

    this.fetchSavedSearches();
    this.fetchProcessingIssues();
    this.fetchTags();
  },

  componentDidMount() {
    this.fetchData();
  },

  componentWillReceiveProps(nextProps) {
    if (nextProps.environment !== this.props.environment) {
      const environment = nextProps.environment;
      const query = queryString.getQueryStringWithEnvironment(
        this.state.query,
        environment === null ? null : environment.name
      );
      this.setState(
        {
          query,
        },
        this.fetchData
      );
    }

    // you cannot apply both a query and a saved search (our routes do not
    // support it), so the searchId takes priority
    let nextSearchId = nextProps.params.searchId || null;

    let searchIdChanged = this.state.isDefaultSearch
      ? nextSearchId
      : nextSearchId !== this.state.searchId;

    if (searchIdChanged || nextProps.location.search !== this.props.location.search) {
      // TODO(dcramer): handle 404 from popState on searchId
      this.setState(this.getQueryState(nextProps), this.fetchData);
    }
  },

  componentDidUpdate(prevProps, prevState) {
    if (prevState.realtimeActive !== this.state.realtimeActive) {
      // User toggled realtime button
      if (this.state.realtimeActive) {
        this.resumePolling();
      } else {
        this._poller.disable();
      }
    }
  },

  componentWillUnmount() {
    this._poller.disable();
    GroupStore.reset();
  },

  fetchSavedSearches() {
    this.setState({
      savedSearchLoading: true,
    });

    const {orgId, projectId} = this.props.params;
    const {searchId} = this.state;

    this.api.request(`/projects/${orgId}/${projectId}/searches/`, {
      success: data => {
        const newState = {
          isDefaultSearch: false,
          savedSearchLoading: false,
          savedSearchList: data,
          loading: false,
        };
        let needsData = this.state.loading;
        if (searchId) {
          const match = data.find(search => search.id === searchId);

          if (match) {
            newState.query = match.query;
          } else {
            this.setState(
              {
                savedSearchLoading: false,
                savedSearchList: data,
                searchId: null,
                isDefaultSearch: true,
              },
              this.transitionTo
            );
          }
        } else if (!this.hasQuery()) {
          const defaultResult =
            data.find(search => search.isUserDefault) ||
            data.find(search => search.isDefault);

          if (defaultResult) {
            newState.searchId = defaultResult.id;
            newState.query = defaultResult.query;
            newState.isDefaultSearch = true;
          }
        }

        this.setState(newState, needsData ? this.fetchData : null);
      },
      error: error => {
        // XXX(dcramer): fail gracefully by still loading the stream
        logAjaxError(error);
        this.setState({
          loading: false,
          isDefaultSearch: null,
          searchId: null,
          savedSearchList: [],
          savedSearchLoading: false,
          query: '',
        });
      },
    });
  },

  fetchProcessingIssues() {
    let {orgId, projectId} = this.props.params;
    this.api.request(`/projects/${orgId}/${projectId}/processingissues/`, {
      success: data => {
        if (data.hasIssues || data.resolveableIssues > 0 || data.issuesProcessing > 0) {
          this.setState({
            processingIssues: data,
          });
        }
      },
      error: error => {
        logAjaxError(error);
        // this is okay. it's just a ui hint
      },
    });
  },

  fetchTags() {
    StreamTagStore.reset();
    StreamTagActions.loadTags();

    this.setState({
      tagsLoading: true,
    });

    let params = this.props.params;
    this.api.request(`/projects/${params.orgId}/${params.projectId}/tags/`, {
      success: tags => {
        let trimmedTags = tags.slice(0, MAX_TAGS);

        if (tags.length > MAX_TAGS) {
          AlertActions.addAlert({
            message: t('You have too many unique tags and some have been truncated'),
            type: 'warn',
          });
        }
        this.setState({tagsLoading: false});
        StreamTagActions.loadTagsSuccess(trimmedTags);
      },
      error: error => {
        this.setState({tagsLoading: false});
        StreamTagActions.loadTagsError();
      },
    });
  },

  showingProcessingIssues() {
    return this.state.query && this.state.query.trim() == 'is:unprocessed';
  },

  onSavedSearchCreate(data) {
    let {orgId, projectId} = this.props.params;
    let savedSearchList = this.state.savedSearchList;
    savedSearchList.push(data);
    // TODO(dcramer): sort
    this.setState({
      savedSearchList,
    });
    browserHistory.push(`/${orgId}/${projectId}/searches/${data.id}/`);
  },

  getQueryState(props) {
    props = props || this.props;
    let currentQuery = props.location.query || {};
    let state = this.state;

    let hasQuery = 'query' in currentQuery;

    let searchId = hasQuery ? null : props.params.searchId || state.searchId || null;

    let sort = 'sort' in currentQuery ? currentQuery.sort : DEFAULT_SORT;

    let statsPeriod =
      'statsPeriod' in currentQuery ? currentQuery.statsPeriod : DEFAULT_STATS_PERIOD;

    if (statsPeriod !== '14d' && statsPeriod !== '24h') {
      statsPeriod = DEFAULT_STATS_PERIOD;
    }

    let newState = {
      sort,
      statsPeriod,
      query: hasQuery ? currentQuery.query : '',
      searchId,
      isDefaultSearch: false,
    };

    if (searchId) {
      let searchResult = this.state.savedSearchList.find(
        search => search.id === searchId
      );
      if (searchResult) {
        newState.query = searchResult.query;
      } else {
        newState.searchId = null;
      }
    } else if (!hasQuery) {
      let defaultResult = this.state.savedSearchList.find(search => search.isDefault);
      if (defaultResult) {
        newState.isDefaultSearch = true;
        newState.searchId = defaultResult.id;
        newState.query = defaultResult.query;
      } else {
        newState.searchId = null;
      }
    }
    newState.loading = false;
    return newState;
  },

  hasQuery(props) {
    props = props || this.props;
    let currentQuery = props.location.query || {};
    return 'query' in currentQuery;
  },

  fetchData() {
    GroupStore.loadInitialData([]);

    this.setState({
      dataLoading: true,
      queryCount: null,
      error: false,
    });

    let url = this.getGroupListEndpoint();

    // Remove leading and trailing whitespace
    let query = queryString.formatQueryString(this.state.query);

    let {environment} = this.props;
    let activeEnvName = environment ? environment.name : null;

    let requestParams = {
      query,
      limit: MAX_ITEMS,
      sort: this.state.sort,
      statsPeriod: this.state.statsPeriod,
      shortIdLookup: '1',
    };

    // Always keep the global active environment in sync with the queried environment
    // The global environment wins unless there one is specified by the saved search
    const queryEnvironment = queryString.getQueryEnvironment(query);

    if (queryEnvironment !== null) {
      // Set the global environment to the one specified by the saved search
      if (queryEnvironment !== activeEnvName) {
        if (this.state.hasEnvironmentsFeature) {
          let env = EnvironmentStore.getByName(queryEnvironment);
          setActiveEnvironment(env);
        }
      }
      requestParams.environment = queryEnvironment;
    } else if (environment) {
      // Set the environment of the query to match the global settings
      query = queryString.getQueryStringWithEnvironment(query, environment.name);
      requestParams.query = query;
      requestParams.environment = environment.name;
    }

    let currentQuery = this.props.location.query || {};
    if ('cursor' in currentQuery) {
      requestParams.cursor = currentQuery.cursor;
    }

    if (this.lastRequest) {
      this.lastRequest.cancel();
    }

    this._poller.disable();

    this.lastRequest = this.api.request(url, {
      method: 'GET',
      data: requestParams,
      success: (data, ignore, jqXHR) => {
        // if this is a direct hit, we redirect to the intended result directly.
        // we have to use the project slug from the result data instead of the
        // the current props one as the shortIdLookup can return results for
        // different projects.
        if (jqXHR.getResponseHeader('X-Sentry-Direct-Hit') === '1') {
          if (data[0].matchingEventId) {
            return void browserHistory.push(
              `/${this.props.params.orgId}/${data[0].project.slug}/issues/${data[0]
                .id}/events/${data[0].matchingEventId}/`
            );
          }
          return void browserHistory.push(
            `/${this.props.params.orgId}/${data[0].project.slug}/issues/${data[0].id}/`
          );
        }

        this._streamManager.push(data);

        let queryCount = jqXHR.getResponseHeader('X-Hits');
        let queryMaxCount = jqXHR.getResponseHeader('X-Max-Hits');

        return void this.setState({
          error: false,
          dataLoading: false,
          query,
          queryCount:
            typeof queryCount !== 'undefined' ? parseInt(queryCount, 10) || 0 : 0,
          queryMaxCount:
            typeof queryMaxCount !== 'undefined' ? parseInt(queryMaxCount, 10) || 0 : 0,
          pageLinks: jqXHR.getResponseHeader('Link'),
        });
      },
      error: err => {
        let error = err.responseJSON || true;
        error = error.detail || true;
        this.setState({
          error,
          dataLoading: false,
        });
      },
      complete: jqXHR => {
        this.lastRequest = null;

        this.resumePolling();
      },
    });
  },

  resumePolling() {
    if (!this.state.pageLinks) return;

    // Only resume polling if we're on the first page of results
    let links = parseLinkHeader(this.state.pageLinks);
    if (links && !links.previous.results && this.state.realtimeActive) {
      this._poller.setEndpoint(links.previous.href);
      this._poller.enable();
    }
  },

  getGroupListEndpoint() {
    let params = this.props.params;

    return '/projects/' + params.orgId + '/' + params.projectId + '/issues/';
  },

  onRealtimeChange(realtime) {
    Cookies.set('realtimeActive', realtime.toString());
    this.setState({
      realtimeActive: realtime,
    });
  },

  onSelectStatsPeriod(period) {
    if (period != this.state.statsPeriod) {
      // TODO(dcramer): all charts should now suggest "loading"
      this.setState(
        {
          statsPeriod: period,
        },
        function() {
          this.transitionTo();
        }
      );
    }
  },

  onRealtimePoll(data, links) {
    this._streamManager.unshift(data);
    if (!utils.valueIsEqual(this.state.pageLinks, links, true)) {
      this.setState({
        pageLinks: links,
      });
    }
  },

  onGroupChange() {
    let groupIds = this._streamManager.getAllItems().map(item => item.id);
    if (!utils.valueIsEqual(groupIds, this.state.groupIds)) {
      this.setState({
        groupIds,
      });
    }
  },

  onStreamTagChange(tags) {
    // new object to trigger state change
    this.setState({
      tags: {...tags},
    });
  },

  onSearch(query) {
    if (query === this.state.query) {
      // if query is the same, just re-fetch data
      this.fetchData();
    } else {
      this.setState(
        {
          query,
          searchId: null,
        },
        this.transitionTo
      );
    }
  },

  onSortChange(sort) {
    this.setState(
      {
        sort,
      },
      this.transitionTo
    );
  },

  onSidebarToggle() {
    this.setState({
      isSidebarVisible: !this.state.isSidebarVisible,
    });
  },

  /**
   * Returns true if all results in the current query are visible/on this page
   */
  allResultsVisible() {
    if (!this.state.pageLinks) return false;

    let links = parseLinkHeader(this.state.pageLinks);
    return links && !links.previous.results && !links.next.results;
  },

  transitionTo() {
    let queryParams = {};

    if (!this.state.searchId) {
      queryParams.query = this.state.query;
    }

    if (this.state.sort !== DEFAULT_SORT) {
      queryParams.sort = this.state.sort;
    }

    if (this.state.statsPeriod !== DEFAULT_STATS_PERIOD) {
      queryParams.statsPeriod = this.state.statsPeriod;
    }

    let params = this.props.params;

    let path = this.state.searchId
      ? `/${params.orgId}/${params.projectId}/searches/${this.state.searchId}/`
      : `/${params.orgId}/${params.projectId}/`;

    browserHistory.push({
      pathname: path,
      query: queryParams,
    });
  },

  createSampleEvent() {
    let params = this.props.params;
    let url = `/projects/${params.orgId}/${params.projectId}/create-sample/`;
    this.api.request(url, {
      method: 'POST',
      success: data => {
        browserHistory.push(
          `/${params.orgId}/${params.projectId}/issues/${data.groupID}/`
        );
      },
    });
  },

  renderProcessingIssuesHint() {
    let pi = this.state.processingIssues;
    if (!pi || this.showingProcessingIssues()) {
      return null;
    }

    let {orgId, projectId} = this.props.params;
    let link = `/${orgId}/${projectId}/settings/processing-issues/`;
    let showButton = false;
    let className = {
      'processing-issues': true,
      alert: true,
    };
    let issues = null;
    let lastEvent = null;
    let icon = null;

    if (pi.numIssues > 0) {
      icon = <span className="icon icon-alert" />;
      issues = tn(
        'There is %d issue blocking event processing',
        'There are %d issues blocking event processing',
        pi.numIssues
      );
      lastEvent = (
        <span className="last-seen">
          ({tct('last event from [ago]', {
            ago: <TimeSince date={pi.lastSeen} />,
          })})
        </span>
      );
      className['alert-error'] = true;
      showButton = true;
    } else if (pi.issuesProcessing > 0) {
      icon = <span className="icon icon-processing play" />;
      className['alert-info'] = true;
      issues = tn(
        'Reprocessing %d event …',
        'Reprocessing %d events …',
        pi.issuesProcessing
      );
    } else if (pi.resolveableIssues > 0) {
      icon = <span className="icon icon-processing" />;
      className['alert-warning'] = true;
      issues = tn(
        'There is %d event pending reprocessing.',
        'There are %d events pending reprocessing.',
        pi.resolveableIssues
      );
      showButton = true;
    } else {
      /* we should not go here but what do we know */ return null;
    }
    return (
      <div className={classNames(className)}>
        {showButton && (
          <Link to={link} className="btn btn-default btn-sm pull-right">
            {t('Show details')}
          </Link>
        )}
        {icon} <strong>{issues}</strong> {lastEvent}{' '}
      </div>
    );
  },

  renderGroupNodes(ids, statsPeriod) {
    let {orgId, projectId} = this.props.params;
    let groupNodes = ids.map(id => {
      return (
        <StreamGroup
          key={id}
          id={id}
          orgId={orgId}
          projectId={projectId}
          statsPeriod={statsPeriod}
        />
      );
    });
    return <ul className="group-list">{groupNodes}</ul>;
  },

  renderAwaitingEvents() {
    let org = this.getOrganization();
    let project = this.getProject();
    let sampleLink = null;
    if (this.state.groupIds.length > 0) {
      let sampleIssueId = this.state.groupIds[0];

      sampleLink = (
        <p>
          <Link to={`/${org.slug}/${project.slug}/issues/${sampleIssueId}/?sample`}>
            {t('Or see your sample event')}
          </Link>
        </p>
      );
    } else {
      sampleLink = (
        <p>
          <a onClick={this.createSampleEvent.bind(this, project.platform)}>
            {t('Create a sample event')}
          </a>
        </p>
      );
    }

    return (
      <div className="box awaiting-events">
        <div className="wrap">
          <div className="robot">
            <span className="eye" />
          </div>
          <h3>{t('Waiting for events…')}</h3>
          <p>
            {tct(
              'Our error robot is waiting to [cross:devour] receive your first event.',
              {
                cross: <span className="strikethrough" />,
              }
            )}
          </p>
          <p>
            <Link
              to={`/${org.slug}/${project.slug}/getting-started/`}
              className="btn btn-primary btn-lg"
            >
              {t('Installation Instructions')}
            </Link>
          </p>
          {sampleLink}
        </div>
      </div>
    );
  },

  renderEmpty() {
    return (
      <div className="box empty-stream">
        <span className="icon icon-exclamation" />
        <p>{t('Sorry, no events match your filters.')}</p>
      </div>
    );
  },

  renderLoading() {
    return (
      <div className="box">
        <LoadingIndicator />
      </div>
    );
  },

  renderStreamBody() {
    let body;
    let project = this.getProject();
    if (this.state.dataLoading) {
      body = this.renderLoading();
    } else if (this.state.error) {
      body = <LoadingError message={this.state.error} onRetry={this.fetchData} />;
    } else if (!project.firstEvent) {
      body = this.renderAwaitingEvents();
    } else if (this.state.groupIds.length > 0) {
      body = this.renderGroupNodes(this.state.groupIds, this.state.statsPeriod);
    } else {
      body = this.renderEmpty();
    }
    return body;
  },

  render() {
    // global loading
    if (this.state.loading) {
      return this.renderLoading();
    }
    let params = this.props.params;
    let classes = ['stream-row'];
    if (this.state.isSidebarVisible) classes.push('show-sidebar');
    let {orgId, projectId} = this.props.params;
    let searchId = this.state.searchId;
    let access = this.getAccess();
    let projectFeatures = this.getProjectFeatures();
    return (
      <StickyContainer>
        <div className={classNames(classes)}>
          <div className="stream-content">
            <StreamFilters
              access={access}
              orgId={orgId}
              projectId={projectId}
              query={this.state.query}
              sort={this.state.sort}
              tags={this.state.tags}
              searchId={searchId}
              queryCount={this.state.queryCount}
              queryMaxCount={this.state.queryMaxCount}
              onSortChange={this.onSortChange}
              onSearch={this.onSearch}
              onSavedSearchCreate={this.onSavedSearchCreate}
              onSidebarToggle={this.onSidebarToggle}
              isSearchDisabled={this.state.isSidebarVisible}
              savedSearchList={this.state.savedSearchList}
            />
            <Sticky topOffset={59}>
              {props => (
                <div className={classNames('group-header', {sticky: props.isSticky})}>
                  <StreamActions
                    orgId={params.orgId}
                    projectId={params.projectId}
                    hasReleases={projectFeatures.has('releases')}
                    latestRelease={this.context.project.latestRelease}
                    query={this.state.query}
                    onSelectStatsPeriod={this.onSelectStatsPeriod}
                    onRealtimeChange={this.onRealtimeChange}
                    realtimeActive={this.state.realtimeActive}
                    statsPeriod={this.state.statsPeriod}
                    groupIds={this.state.groupIds}
                    allResultsVisible={this.allResultsVisible()}
                  />
                </div>
              )}
            </Sticky>
            {this.renderProcessingIssuesHint()}
            {this.renderStreamBody()}
            <Pagination pageLinks={this.state.pageLinks} />
          </div>
          <StreamSidebar
            loading={this.state.tagsLoading}
            tags={this.state.tags}
            query={this.state.query}
            onQueryChange={this.onSearch}
            orgId={params.orgId}
            projectId={params.projectId}
          />
        </div>
      </StickyContainer>
    );
  },
});
export default Stream;